/**
 * #631 — shared instrument for the "optional *Deps member" class #625 found.
 *
 * #625 fixed ONE forgotten optional member (`childRowConsolidator` on
 * `FilingPersisterDeps`) and added an enumerating test that reads the
 * interface's members from the SOURCE (never a hand-typed list, never a
 * hand-rolled scanner — `never-hand-roll-a-lexer.md`) via the TypeScript
 * compiler API, then asserts the production builder leaves none of them
 * `undefined`. #631 generalises that instrument so it can be pointed at any
 * of the 8 `*Deps` interfaces the audit found, instead of re-deriving the
 * AST walk per file.
 *
 * What this does NOT claim: an optional member is not automatically a
 * defect. Many are deliberately optional with a real fallback inside the
 * function that consumes them (`deps.now ?? (() => new Date())`, etc.) — see
 * `docs/reviews/failure-classes/optional-deps-member-unwired.json`. This
 * helper's job is to make every optional member NAMED and REVIEWED: either
 * the production builder supplies it, or it is on that builder's own
 * allow-list with a one-line reason a reviewer can check against the actual
 * fallback code. A member that is neither wired nor allow-listed fails the
 * test — that is the silent-gap #625 found, now caught before merge instead
 * of by a live-data query.
 */
import { readFileSync } from 'node:fs';
import ts from 'typescript';

export interface DeclaredMember {
  name: string;
  optional: boolean;
}

/**
 * Member names (and optionality) declared directly on `interface
 * <interfaceName>` in `filePath`, read from the AST. Does not follow
 * `extends` — every `*Deps` interface in this audit declares its members
 * directly, and a future one that extends another should say so explicitly
 * in its own allow-list rather than have this silently walk a base type.
 */
export function declaredInterfaceMembers(filePath: string, interfaceName: string): DeclaredMember[] {
  const source = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const members: DeclaredMember[] = [];
  sourceFile.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      for (const member of node.members) {
        // A `*Deps` interface mixes two declaration shapes for the same thing
        // — `foo: (x: T) => R` (PropertySignature with a function type) and
        // `foo(x: T): R` (MethodSignature, TS shorthand for the same type).
        // Reading only PropertySignature silently dropped every
        // method-shorthand member (measured: `IssueTypeFillDeps` and
        // `IssueTypeJobDeps` are declared almost entirely in method shorthand
        // and read as 1 member each instead of 8/9) — the exact silent-gap
        // shape this instrument exists to catch, just moved into the
        // instrument itself. Both shapes are read here.
        if (
          (ts.isPropertySignature(member) || ts.isMethodSignature(member)) &&
          member.name &&
          ts.isIdentifier(member.name)
        ) {
          members.push({ name: member.name.text, optional: member.questionToken != null });
        }
      }
    }
  });
  return members;
}

/**
 * Every OPTIONAL member of `members` that (a) the constructed production
 * `deps` object leaves `undefined` AND (b) has no entry in `allowlist`. A
 * non-empty result means: this member is silently unwired and nobody has
 * reviewed whether that is safe — the #625 shape, generalised.
 *
 * `allowlist` keys are member names; values are the one-line reason a
 * reviewer can check against the code (e.g. "checkDeployDrift defaults via
 * `deps.getConfigSha ?? getConfigShaForSlot`, the real implementation").
 */
export function unexplainedUnwiredOptionals(
  deps: Record<string, unknown>,
  members: DeclaredMember[],
  allowlist: Readonly<Record<string, string>>
): string[] {
  return members
    .filter((m) => m.optional)
    .filter((m) => deps[m.name] === undefined)
    .filter((m) => !(m.name in allowlist))
    .map((m) => m.name);
}
