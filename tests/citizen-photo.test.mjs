import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync("src/app/(citizen)/report/photo.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const config = {
  PHOTO_CONFIG: {
    max_original_bytes: 10,
    max_edge_px: 1600,
    output_mime_type: "image/jpeg",
    jpeg_quality: 0.8,
  },
  STORAGE_BUCKET_LIMITS: { file_size_limit_bytes: 20 },
};
const module = { exports: {} };
new Function("require", "module", "exports", compiled)(
  () => config,
  module,
  module.exports,
);
const { prepareReportPhoto } = module.exports;

test("photo preparation rejects oversized and unreadable originals", async () => {
  await assert.rejects(
    prepareReportPhoto({ type: "image/png", size: 11 }),
    /smaller than 10 MB/,
  );
  globalThis.createImageBitmap = async () => {
    throw new Error("decode failed");
  };
  await assert.rejects(
    prepareReportPhoto({ type: "image/heic", size: 5 }),
    /JPEG or PNG/,
  );
});

test("photo preparation resizes, exports JPEG and closes bitmap", async () => {
  let closed = false;
  let drawn = false;
  const output = new Blob(["jpeg"], { type: "image/jpeg" });
  globalThis.createImageBitmap = async () => ({
    width: 3200,
    height: 1600,
    close: () => {
      closed = true;
    },
  });
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: () => {
          drawn = true;
        },
      }),
      toBlob: (resolve, type, quality) => {
        assert.equal(type, "image/jpeg");
        assert.equal(quality, 0.8);
        resolve(output);
      },
    }),
  };
  assert.equal(
    await prepareReportPhoto({ type: "image/png", size: 5 }),
    output,
  );
  assert.ok(drawn);
  assert.ok(closed);
});
