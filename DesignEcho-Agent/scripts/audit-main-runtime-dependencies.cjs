#!/usr/bin/env node
"use strict";

const assert = require('assert');
const fs = require('fs');
const { builtinModules } = require('module');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'src', 'main');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const runtimeProvidedPackages = new Set(['electron']);
const builtins = new Set(builtinModules.flatMap((name) => [name, name.replace(/^node:/, '')]));

function collectSourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(absolutePath);
  }
  return files;
}

function toPackageName(specifier) {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
    return '';
  }
  const parts = specifier.split('/');
  const packageName = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return builtins.has(packageName) ? '' : packageName;
}

function importDeclarationIsRuntime(node) {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  if (!clause.namedBindings) return false;
  if (ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
}

function exportDeclarationIsRuntime(node) {
  if (node.isTypeOnly) return false;
  if (!node.exportClause) return true;
  if (ts.isNamespaceExport(node.exportClause)) return true;
  return node.exportClause.elements.some((element) => !element.isTypeOnly);
}

function readStaticSpecifier(node) {
  if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return node.arguments[0].text;
    if (ts.isIdentifier(node.expression) && node.expression.text === 'require') return node.arguments[0].text;
    if (ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && node.expression.expression.text === 'require'
      && node.expression.name.text === 'resolve') return node.arguments[0].text;
  }
  if (ts.isImportEqualsDeclaration(node)
    && !node.isTypeOnly
    && ts.isExternalModuleReference(node.moduleReference)
    && node.moduleReference.expression
    && ts.isStringLiteral(node.moduleReference.expression)) {
    return node.moduleReference.expression.text;
  }
  return '';
}

function collectRuntimeImports(filePath) {
  const sourceText = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
  const imports = new Set();

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)
      && ts.isStringLiteral(statement.moduleSpecifier)
      && importDeclarationIsRuntime(statement)) {
      imports.add(statement.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(statement)
      && statement.moduleSpecifier
      && ts.isStringLiteral(statement.moduleSpecifier)
      && exportDeclarationIsRuntime(statement)) {
      imports.add(statement.moduleSpecifier.text);
    }
  }

  function visit(node) {
    const specifier = readStaticSpecifier(node);
    if (specifier) imports.add(specifier);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return imports;
}

const runtimeImports = new Map();
for (const filePath of collectSourceFiles(sourceRoot)) {
  for (const specifier of collectRuntimeImports(filePath)) {
    const packageName = toPackageName(specifier);
    if (!packageName) continue;
    if (!runtimeImports.has(packageName)) runtimeImports.set(packageName, new Set());
    runtimeImports.get(packageName).add(path.relative(root, filePath));
  }
}

const declaredRuntimePackages = new Set([
  ...Object.keys(packageJson.dependencies || {}),
  ...Object.keys(packageJson.optionalDependencies || {}),
  ...runtimeProvidedPackages
]);
const missing = [...runtimeImports.entries()]
  .filter(([packageName]) => !declaredRuntimePackages.has(packageName))
  .sort(([left], [right]) => left.localeCompare(right));

assert.deepStrictEqual(
  missing,
  [],
  `Main 源码存在未声明的生产运行时依赖：\n${missing.map(([packageName, files]) => (
    `- ${packageName}: ${[...files].sort().join(', ')}`
  )).join('\n')}`
);

console.log(
  `[OK] Main ${runtimeImports.size} 个外部运行时包均由 dependencies/optionalDependencies `
    + '或 Electron Runtime 显式拥有。'
);
