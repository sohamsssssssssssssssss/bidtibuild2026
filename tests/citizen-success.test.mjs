import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { z } from "zod";

const source = readFileSync(
  "src/app/(citizen)/report/success/page.tsx",
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const module = { exports: {} };
const imports = {
  "react/jsx-runtime": await import("react/jsx-runtime"),
  "next/link": ({ href, children }) =>
    React.createElement("a", { href }, children),
  "@/contracts/primitives": { uuidSchema: z.guid() },
};
new Function("require", "module", "exports", compiled)(
  (name) => imports[name],
  module,
  module.exports,
);
const SuccessPage = module.exports.default;

test("report success links to the saved issue and My Reports", async () => {
  const id = "5eed1000-0000-4000-8000-000000000106";
  const html = renderToStaticMarkup(
    await SuccessPage({ searchParams: Promise.resolve({ issue: id }) }),
  );
  assert.match(html, /href="\/my-reports"/);
  assert.match(html, new RegExp(`href="/issues/${id}"`));
});

test("report success does not link to an invalid issue id", async () => {
  const html = renderToStaticMarkup(
    await SuccessPage({ searchParams: Promise.resolve({ issue: "wrong" }) }),
  );
  assert.doesNotMatch(html, /href="\/issues\//);
});
