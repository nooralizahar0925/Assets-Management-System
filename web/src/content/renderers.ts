/**
 * One request, four languages.
 *
 * The alternative is thirty-two hand-written snippets, and the day somebody
 * renames an endpoint they will update the cURL example and not the PHP one.
 * Describing each flow once and rendering it means the four tabs are provably
 * the same call.
 */

export interface HttpRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  /** Multipart uploads render differently in every language. */
  upload?: {
    field: string;
    filename: string;
    /** The other form fields that travel with the file. */
    fields?: Record<string, string>;
  };
}

const HOST = "https://your-host";
const NL = "\n";

const queryString = (q?: Record<string, string>) =>
  q && Object.keys(q).length > 0 ? `?${new URLSearchParams(q).toString()}` : "";

const url = (req: HttpRequest) => `${HOST}${req.path}${queryString(req.query)}`;

const json = (body: unknown, indent = 2) => JSON.stringify(body, null, indent);

const uploadFields = (req: HttpRequest) =>
  Object.entries(req.upload?.fields ?? {});

export function renderCurl(req: HttpRequest): string {
  const lines = [`curl "${url(req)}"`];
  if (req.method !== "GET") lines.push(`  -X ${req.method}`);
  lines.push(`  -H "Authorization: Bearer $AMS_KEY"`);

  if (req.upload) {
    // No content type: curl chooses the multipart boundary. Declaring it by
    // hand produces a body the server cannot parse.
    lines.push(`  -F "${req.upload.field}=@${req.upload.filename}"`);
    for (const [key, value] of uploadFields(req)) {
      lines.push(`  -F '${key}=${value}'`);
    }
  } else if (req.body !== undefined) {
    lines.push(`  -H "Content-Type: application/json"`);
    lines.push(`  -d '${json(req.body, 0)}'`);
  }

  return lines.join(` \${NL}`);
}

export function renderFetch(req: HttpRequest): string {
  const headers = [`    Authorization: \`Bearer \${process.env.AMS_KEY}\`,`];
  const init = [`  method: "${req.method}",`];
  let preamble = "";

  if (req.upload) {
    const sets = [
      `form.set("${req.upload.field}", await openAsBlob("${req.upload.filename}"), "${req.upload.filename}");`,
      ...uploadFields(req).map(
        ([key, value]) => `form.set(${JSON.stringify(key)}, ${JSON.stringify(value)});`,
      ),
    ];
    preamble = [
      `import { openAsBlob } from "node:fs";`,
      ``,
      `const form = new FormData();`,
      ...sets,
      ``,
      ``,
    ].join(NL);
    // Content-Type is deliberately absent: fetch sets it, with the boundary.
    init.push(`  headers: {${NL}${headers.join(NL)}${NL}  },`);
    init.push(`  body: form,`);
  } else {
    if (req.body !== undefined) headers.push(`    "Content-Type": "application/json",`);
    init.push(`  headers: {${NL}${headers.join(NL)}${NL}  },`);
    if (req.body !== undefined) init.push(`  body: JSON.stringify(${json(req.body)}),`);
  }

  return `${preamble}const res = await fetch("${url(req)}", {
${init.join(NL)}
});

if (!res.ok) {
  // Failures are problem documents: branch on .type, which is stable.
  const problem = await res.json();
  throw new Error(\`\${problem.type}: \${problem.title}\`);
}

console.log(await res.json());`;
}

/** JSON is not Python: `true`, `false` and `null` are all NameErrors there. */
const pythonLiterals = (source: string) =>
  source
    .replace(/\btrue\b/g, "True")
    .replace(/\bfalse\b/g, "False")
    .replace(/\bnull\b/g, "None");

export function renderPython(req: HttpRequest): string {
  const args = [`    "${HOST}${req.path}"`];
  args.push(`    headers={"Authorization": f"Bearer {os.environ['AMS_KEY']}"}`);

  if (req.query) {
    const pairs = Object.entries(req.query)
      .map(([k, v]) => `"${k}": "${v}"`)
      .join(", ");
    args.push(`    params={${pairs}}`);
  }

  if (req.upload) {
    args.push(`    files={"${req.upload.field}": open("${req.upload.filename}", "rb")}`);
    const fields = uploadFields(req)
      .map(([k, v]) => `"${k}": ${JSON.stringify(v)}`)
      .join(", ");
    if (fields) args.push(`    data={${fields}}`);
  } else if (req.body !== undefined) {
    args.push(`    json=${pythonLiterals(json(req.body))}`);
  }

  return `import os
import requests

res = requests.${req.method.toLowerCase()}(
${args.join(`,${NL}`)},
)
res.raise_for_status()
print(res.json())`;
}

export function renderPhp(req: HttpRequest): string {
  const setopt = [
    `curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);`,
    `curl_setopt($ch, CURLOPT_HTTPHEADER, [`,
    `    'Authorization: Bearer ' . getenv('AMS_KEY'),`,
  ];
  if (req.body !== undefined && !req.upload) {
    setopt.push(`    'Content-Type: application/json',`);
  }
  setopt.push(`]);`);

  if (req.method !== "GET") {
    setopt.push(`curl_setopt($ch, CURLOPT_CUSTOMREQUEST, '${req.method}');`);
  }

  if (req.upload) {
    setopt.push(
      `curl_setopt($ch, CURLOPT_POSTFIELDS, [`,
      `    '${req.upload.field}' => new CURLFile('${req.upload.filename}'),`,
      ...uploadFields(req).map(([key, value]) => `    '${key}' => '${value}',`),
      `]);`,
    );
  } else if (req.body !== undefined) {
    setopt.push(
      `curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(${phpArray(req.body)}));`,
    );
  }

  return `<?php
$ch = curl_init('${url(req)}');
${setopt.join(NL)}

$response = curl_exec($ch);
curl_close($ch);

print_r(json_decode($response, true));`;
}

/** Renders a JS value as a PHP array literal, for the POSTFIELDS argument. */
function phpArray(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `'${value.replace(/'/g, "\'")}'`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(phpArray).join(", ")}]`;
  if (typeof value === "object") {
    const pairs = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `'${k}' => ${phpArray(v)}`)
      .join(", ");
    return `[${pairs}]`;
  }
  return "null";
}
