import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

// Deterministic, read-only (Decision 0241): keeps the standing-grant START card deriver free of agent-supplied inputs.
// The deriver may read only main's revision, the Plan frontmatter, the queue, the production policy, the receipts and the clock;
// each field of its input type belongs to one of those. It also keeps START_RUN_KEYS and the keys the deriver computes equal.
export const DERIVER_PATH = "src/operatorActions/startRunDerive.ts";
export const PINS_PATH = "src/operatorActions/startRunPins.ts";
export const DERIVER_FUNCTION = "deriveStartCard";
export const DERIVER_INPUT_TYPE = "DeriveInput";
/** Every allowed input field, with the one fixed source it is read from. A new field must be added here, in review. */
export const DERIVER_INPUT_SOURCES: Readonly<Record<string, string>> = {
  originMain: "main revision", executorSha256: "main revision", workspace: "main revision", workerLabel: "main revision", gateCardId: "main revision", offId: "main revision",
  plan: "Plan frontmatter", answeredDecisions: "Plan frontmatter",
  queue: "queue", production: "production policy",
  grant: "receipts", chain: "receipts", consumedHistory: "receipts", failedBatchClearance: "receipts",
  now: "clock"
};

const parse = (source: string, name: string) => ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
const hasExport = (node: ts.Node): boolean => !!ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
const propertyName = (member: ts.ObjectLiteralElementLike): string | null =>
  member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) ? member.name.text : null;

export function checkDeriverInputs(deriverSource: string): string[] {
  const errors: string[] = [];
  const file = parse(deriverSource, DERIVER_PATH);
  const exported = file.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && hasExport(node) && node.name?.text === DERIVER_FUNCTION);
  if (exported.length !== 1) return [`${DERIVER_PATH} must export exactly one function ${DERIVER_FUNCTION}`];
  const params = exported[0].parameters;
  if (params.length !== 1 || params[0].type?.getText(file) !== DERIVER_INPUT_TYPE) errors.push(`${DERIVER_FUNCTION} must take exactly one parameter of type ${DERIVER_INPUT_TYPE}; it takes (${params.map((param) => param.getText(file)).join(", ")})`);
  const input = file.statements.find((node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node) && node.name.text === DERIVER_INPUT_TYPE);
  if (!input) return [...errors, `${DERIVER_PATH} declares no interface ${DERIVER_INPUT_TYPE}`];
  if (input.heritageClauses?.length) errors.push(`${DERIVER_INPUT_TYPE} must not extend another type`);
  for (const member of input.members) {
    const name = member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) ? member.name.text : null;
    if (!name || !(name in DERIVER_INPUT_SOURCES)) errors.push(`${DERIVER_INPUT_TYPE} gains the field ${name ?? member.getText(file)}, outside the fixed input set (main revision, Plan frontmatter, queue, production policy, receipts, clock)`);
  }
  return errors;
}

export function checkStartRunKeys(deriverSource: string, pinsSource: string): string[] {
  const pins = parse(pinsSource, PINS_PATH);
  let declared: string[] | null = null;
  pins.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === "START_RUN_KEYS" && declaration.initializer && ts.isArrayLiteralExpression(declaration.initializer)) {
        declared = declaration.initializer.elements.filter(ts.isStringLiteralLike).map((element) => element.text);
      }
    }
  });
  if (!declared) return [`${PINS_PATH} declares no START_RUN_KEYS array literal`];
  const file = parse(deriverSource, DERIVER_PATH);
  let computed: string[] | null = null;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "startRun" && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      const properties = node.initializer.properties;
      computed = properties.map(propertyName).filter((name): name is string => name !== null && name !== "delegation");
      if (properties.some((member) => ts.isSpreadAssignment(member) || propertyName(member) === null)) computed.push("<spread or computed key>");
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!computed) return [`${DERIVER_PATH} computes no startRun object literal`];
  const have = new Set<string>(computed);
  const want = new Set<string>(declared);
  return [
    ...[...want].filter((key) => !have.has(key)).sort().map((key) => `START_RUN_KEYS has the key ${key}, which the deriver does not compute`),
    ...[...have].filter((key) => !want.has(key)).sort().map((key) => `the deriver computes the key ${key}, which START_RUN_KEYS does not list`)
  ];
}

export function checkStartCardDeriver(root: string): string[] {
  const deriver = readFileSync(path.join(root, DERIVER_PATH), "utf8");
  const pins = readFileSync(path.join(root, PINS_PATH), "utf8");
  return [...checkDeriverInputs(deriver), ...checkStartRunKeys(deriver, pins)];
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const errors = checkStartCardDeriver(process.argv[2] ?? path.resolve(import.meta.dirname, ".."));
  if (errors.length) {
    for (const error of errors) console.error(`start-card deriver check: ${error}`);
    process.exit(1);
  }
  console.log("start-card deriver check: the deriver takes only the fixed input set and computes every START_RUN_KEYS key");
}
