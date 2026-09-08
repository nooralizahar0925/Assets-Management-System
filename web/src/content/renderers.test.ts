import { describe, it, expect } from "vitest";
import {
  renderCurl, renderFetch, renderPython, renderPhp, type HttpRequest,
} from "./renderers";
import { RECIPES } from "./recipes";

const listAssets: HttpRequest = {
  method: "GET",
  path: "/api/v1/assets",
  query: { status: "in_use", per_page: "100" },
};

const createAsset: HttpRequest = {
  method: "POST",
  path: "/api/v1/assets",
  body: { name: "ThinkPad X1", purchase_cost: 24500000, active: true },
};

const upload: HttpRequest = {
  method: "POST",
  path: "/api/v1/imports",
  upload: { field: "file", filename: "assets.csv", fields: { dry_run: "true" } },
};

describe("renderCurl", () => {
  it("puts the query string on the URL and quotes it", () => {
    expect(renderCurl(listAssets))
      .toContain('"https://your-host/api/v1/assets?status=in_use&per_page=100"');
  });

  it("sends the bearer token", () => {
    expect(renderCurl(listAssets)).toContain('-H "Authorization: Bearer $AMS_KEY"');
  });

  it("omits the method flag for GET but states it for POST", () => {
    expect(renderCurl(listAssets)).not.toContain("-X GET");
    expect(renderCurl(createAsset)).toContain("-X POST");
  });

  it("sends a JSON content type only when there is a body", () => {
    expect(renderCurl(createAsset)).toContain('-H "Content-Type: application/json"');
    expect(renderCurl(listAssets)).not.toContain("Content-Type");
  });

  it("uploads a file with -F and never declares a content type for it", () => {
    // curl must choose the multipart boundary; declaring the type by hand
    // produces a body the server cannot parse.
    const out = renderCurl(upload);
    expect(out).toContain('-F "file=@assets.csv"');
    expect(out).toContain("-F 'dry_run=true'");
    expect(out).not.toContain("Content-Type");
  });
});

describe("renderFetch", () => {
  it("awaits the response and parses JSON", () => {
    expect(renderFetch(listAssets)).toContain("await fetch(");
    expect(renderFetch(listAssets)).toContain("await res.json()");
  });

  it("serialises the body with JSON.stringify", () => {
    expect(renderFetch(createAsset)).toContain("JSON.stringify(");
  });

  it("reads the problem document instead of the bare status", () => {
    expect(renderFetch(listAssets)).toContain("problem.type");
  });

  it("lets fetch set the multipart content type itself", () => {
    const out = renderFetch(upload);
    expect(out).toContain("new FormData()");
    expect(out).not.toContain("Content-Type");
  });
});

describe("renderPython", () => {
  it("uses requests with a params dict for the query", () => {
    const out = renderPython(listAssets);
    expect(out).toContain("import requests");
    expect(out).toContain('params={"status": "in_use", "per_page": "100"}');
  });

  it("passes a body as json=", () => {
    expect(renderPython(createAsset)).toContain("json={");
  });

  it("writes Python booleans, not JavaScript ones", () => {
    // `true` is a NameError in Python: a snippet that cannot run is worse
    // than no snippet, because the reader debugs their own code first.
    const out = renderPython(createAsset);
    expect(out).toContain("True");
    expect(out).not.toMatch(/\btrue\b/);
  });

  it("opens the file for an upload", () => {
    expect(renderPython(upload)).toContain('files={"file": open("assets.csv", "rb")}');
  });
});

describe("renderPhp", () => {
  it("opens with a php tag and uses curl", () => {
    const out = renderPhp(listAssets);
    expect(out.startsWith("<?php")).toBe(true);
    expect(out).toContain("curl_init");
  });

  it("renders a JSON body as a PHP array, not as JavaScript", () => {
    const out = renderPhp(createAsset);
    expect(out).toContain("'name' => 'ThinkPad X1'");
    expect(out).toContain("json_encode(");
  });

  it("uses CURLFile for an upload", () => {
    expect(renderPhp(upload)).toContain("new CURLFile('assets.csv')");
  });
});

describe("the recipe catalogue", () => {
  it("covers the eight flows the spec names", () => {
    expect(RECIPES.map((r) => r.id)).toEqual([
      "list-assets",
      "create-asset",
      "update-custom-fields",
      "check-out",
      "check-in",
      "read-history",
      "bulk-import",
      "resolve-tag",
    ]);
  });

  it("renders every recipe in every language without throwing", () => {
    for (const recipe of RECIPES) {
      for (const render of [renderCurl, renderFetch, renderPython, renderPhp]) {
        expect(render(recipe.request).length, recipe.id).toBeGreaterThan(20);
      }
    }
  });

  it("gives every recipe a title and a blurb", () => {
    for (const recipe of RECIPES) {
      expect(recipe.title.length).toBeGreaterThan(3);
      expect(recipe.blurb.length).toBeGreaterThan(20);
    }
  });

  it("points every recipe at a path this API actually serves", () => {
    // The plan's draft had /check-out, /check-in and /api/v1/tags/<tag>, none
    // of which exist. A recipe for a 404 is worse than no recipe at all.
    const REAL = [
      "/api/v1/assets",
      "/api/v1/assets/lookup",
      "/api/v1/assets/<asset-uuid>",
      "/api/v1/assets/<asset-uuid>/checkout",
      "/api/v1/assets/<asset-uuid>/checkin",
      "/api/v1/assets/<asset-uuid>/history",
      "/api/v1/imports",
    ];
    for (const recipe of RECIPES) {
      expect(REAL, recipe.id).toContain(recipe.request.path);
    }
  });
});
