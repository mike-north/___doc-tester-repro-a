// @ts-check

const comments = require('@code-to-json/comments');
const linker = require('@code-to-json/formatter-linker');
const {
  createProgramFromTsConfig,
  createReverseResolver
} = require('@code-to-json/utils-ts');
const { NODE_HOST, findPkgJson } = require('@code-to-json/utils-node');
const { walkProgram } = require('@code-to-json/core');
const { formatWalkerOutput } = require('@code-to-json/formatter');
const { runTest } = require('doc-tester');
const path = require('path');

/**
 * @typedef DocTest
 * @property {string[]} codeArray
 * @property {string[]} importsArray
 */

/**
 * @typedef DocTestSymbol
 * @property {string} name
 * @property {DocTest[]} tests
 */

/**
 * @typedef DocTestFile
 * @property {string} name
 * @property {DocTestSymbol[]} symbols
 */

/**
 *
 * @template T
 * @param {T | undefined} arg
 * @returns {arg is T}
 */
function isDefined(arg) {
  return typeof arg !== 'undefined';
}

/**
 * Gather information about a particular `@example` or `@doctest` comment block
 * @param {comments.CommentBlockTag} tag
 * @returns {DocTest | undefined}
 */
function gatherDocTest(tag) {
  const { content } = tag;
  if (!content) {
    return;
  }
  /** @type {string[]} */
  const codeArray = [];
  /** @type {string[]} */
  const importsArray = [];
  content
    .join('')
    .split('\n')
    .forEach(s => {
      if (typeof s === 'string' && s !== '\n') {
        if (s.trim().indexOf('import') === 0) {
          importsArray.push(s);
        } else {
          codeArray.push(s);
        }
      }
    });
  debugger;
  return {
    codeArray,
    importsArray
  };
}

/**
 * Gather `@example` or `@doctest` comment blocks for a particular symbol
 * @param {linker.LinkedFormattedSymbol} sym
 * @returns {DocTestSymbol | undefined}
 */
function gatherSymbolDocTests(sym) {
  const { documentation } = sym;
  if (!documentation) {
    return;
  }
  const { customTags } = documentation;
  if (!customTags) {
    return;
  }

  const examples = customTags.filter(
    ct => ['example', 'doctest'].indexOf(ct.tagName) >= 0
  );
  if (examples.length === 0) {
    return;
  }
  const { name } = sym;
  return { name, tests: examples.map(gatherDocTest).filter(isDefined) };
}

/**
 * Gather `@example` or `@doctest` comment blocks for all exported symbols in a particular file
 * @param {linker.LinkedFormattedSourceFile} file
 * @returns {DocTestFile | undefined}
 */
function gatherFileDocTests(file) {
  const fileSym = file.symbol;
  if (!fileSym || typeof fileSym.exports === 'undefined') {
    return;
  }
  const { exports: fileExports } = fileSym;
  const exportSyms = Object.keys(fileExports)
    .map(expName => fileExports[expName])
    .filter(isDefined);
  return {
    name: file.moduleName,
    symbols: exportSyms.map(gatherSymbolDocTests).filter(isDefined)
  };
}

/**
 * Gather `@example` or `@doctest` comment blocks for all exported symbols, across all files in a program
 * @param {linker.LinkedFormattedOutputData} linked
 * @returns {DocTestFile[]}
 */
function gatherProgramDocTests(linked) {
  return Object.keys(linked.sourceFiles)
    .map(k => linked.sourceFiles[k])
    .filter(isDefined)
    .map(gatherFileDocTests)
    .filter(isDefined);
}

/**
 * Find and run doctests for a program found a given path
 * @param {string} pth
 */
async function doctestProgram(pth) {
  const prog = await createProgramFromTsConfig(pth, NODE_HOST);
  const pkg = await findPkgJson(pth);
  if (!pkg) {
    throw new Error(`Could not find package.json via search path "${pth}"`);
  }
  const pkgInfo = {
    path: pkg.path,
    name: pkg.contents.name,
    main: pkg.contents['doc:main'] || pkg.contents.main || pkg.path
  };
  const walkerOutput = walkProgram(prog, NODE_HOST, {
    pathNormalizer: createReverseResolver(NODE_HOST, pkgInfo)
  });

  const formatted = formatWalkerOutput(walkerOutput);
  const linked = linker.linkFormatterData(formatted.data);
  const docTests = gatherProgramDocTests(linked);

  await Promise.all(
    docTests.map(async file => {
      // for each file
      const { name: fileName, symbols } = file;
      if (symbols.length === 0) {
        console.log(`  📦  ${fileName} - no exported symbols w/ doctests`);
        return;
      }
      console.log(`  📦  ${fileName}`);
      await Promise.all(
        // for each symbol exported by the file
        symbols.map(async s => {
          const { name: symName, tests } = s;
          if (tests.length === 0) {
            console.log(`    ${symName} - no doctests`);
            return;
          }
          return Promise.all(
            // for each tagged blog comment (i.e., an @example or @doctest)
            tests.map(async t => {
              const { codeArray, importsArray } = t;
              console.log(`invoking

runTest(${JSON.stringify({ codeArray, importsArray }, null, '  ')});


`);
              // run the test
              await runTest({ codeArray, importsArray });
            })
          )
            .then(() => console.log(`    ✅ ${symName}`))
            .catch(err => console.log(`    ❌ ${symName}: ${err}`));
        })
      );
    })
  );
}

// run the sample program
doctestProgram(path.join(__dirname, '..', '..', 'project-to-analyze'));
