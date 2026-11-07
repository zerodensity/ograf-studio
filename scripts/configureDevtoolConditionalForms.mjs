import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const targetIndex = args.indexOf('--devtool');
if (targetIndex < 0 || !args[targetIndex + 1]) {
  throw new Error('Usage: node scripts/configureDevtoolConditionalForms.mjs --devtool <checkout>');
}
const root = resolve(args[targetIndex + 1]);
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (packageJson.name !== 'ograf-devtool')
  throw new Error('Target is not an OGraf Devtool checkout.');
const componentPath = join(root, 'client/src/components/GraphicAction.jsx');
const formPath = join(root, 'client/src/lib/GDD/ograf-form.jsx');
const helperPath = join(root, 'client/src/lib/GDD/conditionalActionSchema.js');
const sourcePath = fileURLToPath(
  new URL('./integrations/ograf-devtool/conditionalActionSchema.js', import.meta.url),
);
const marker = '// OGraf Studio conditional action form integration';
const original = await readFile(componentPath, 'utf8');
const newline = original.includes('\r\n') ? '\r\n' : '\n';
let updated = original.replaceAll('\r\n', '\n');
if (!updated.includes(marker)) {
  const replacements = [
    [
      "import { getDefaultDataFromSchema } from 'ograf-form'",
      "import { getDefaultDataFromSchema } from 'ograf-form'\n" +
        marker +
        "\nimport { resolveConditionalActionSchema, normalizeConditionalActionData } from '../lib/GDD/conditionalActionSchema.js'",
    ],
    [
      '\tconst [data, setData] = React.useState(initialData)',
      '\tconst [data, setData] = React.useState(initialData)\n\tconst formSchema = resolveConditionalActionSchema(schema, data)\n\tconst formKey = JSON.stringify(formSchema)',
    ],
    [
      '\t\tsetData(JSON.parse(JSON.stringify(d)))',
      '\t\tsetData(JSON.parse(JSON.stringify(normalizeConditionalActionData(schema, d, data))))',
    ],
    [
      '<OGrafForm schema={schema} data={data} setData={onDataSave} />',
      '<OGrafForm key={formKey} schema={formSchema} data={data} setData={onDataSave} />',
    ],
  ];
  for (const [from, to] of replacements) {
    if (updated.split(from).length !== 2)
      throw new Error('Devtool GraphicAction has changed. Review the integration before applying.');
    updated = updated.replace(from, to);
  }
} else {
  for (const required of [
    'key={formKey}',
    'normalizeConditionalActionData(schema, d, data)',
    'schema={formSchema}',
  ]) {
    if (!updated.includes(required))
      throw new Error('Existing conditional integration differs; review before updating.');
  }
}
const formMarker = '// OGraf Studio conditional main data form integration';
const formOriginal = await readFile(formPath, 'utf8');
const formNewline = formOriginal.includes('\r\n') ? '\r\n' : '\n';
let formUpdated = formOriginal.replaceAll('\r\n', '\n');
if (!formUpdated.includes(formMarker)) {
  const replacements = [
    [
      "import { getDefaultDataFromSchema, validateGDDSchema } from 'ograf-form'",
      "import { getDefaultDataFromSchema, validateGDDSchema } from 'ograf-form'\n" +
        formMarker +
        "\nimport { resolveConditionalActionSchema, normalizeConditionalActionData } from './conditionalActionSchema.js'",
    ],
    [
      '\t\tprops.data ? props.data : schema ? getDefaultDataFromSchema(schema) : {}',
      '\t\tnormalizeConditionalActionData(schema, props.data ? props.data : schema ? getDefaultDataFromSchema(schema) : {})',
    ],
    [
      '\tconst prevPropsDataJsonRef = React.useRef(JSON.stringify(props.data))',
      '\tconst prevPropsDataJsonRef = React.useRef(JSON.stringify(props.data))\n' +
        '\tconst normalizedData = normalizeConditionalActionData(schema, data)\n' +
        '\tconst formSchema = resolveConditionalActionSchema(schema, normalizedData)\n' +
        '\tconst formKey = JSON.stringify(formSchema)\n' +
        '\tconst publishedDataJsonRef = React.useRef()\n' +
        '\tReact.useEffect(() => {\n' +
        '\t\tconst inputJson = JSON.stringify(props.data)\n' +
        '\t\tif (prevPropsDataJsonRef.current !== inputJson) return\n' +
        '\t\tconst json = JSON.stringify(normalizedData)\n' +
        '\t\tconst publicationKey = JSON.stringify([inputJson, json])\n' +
        '\t\tif (JSON.stringify(data) !== json) setData(normalizedData)\n' +
        '\t\tif (inputJson !== json && publishedDataJsonRef.current !== publicationKey) {\n' +
        '\t\t\tpublishedDataJsonRef.current = publicationKey\n' +
        '\t\t\tprops.setData?.(normalizedData)\n' +
        '\t\t}\n' +
        '\t}, [normalizedData, data, props.data, props.setData])',
    ],
    [
      '\t\t\tsetData(props.data ? props.data : schema ? getDefaultDataFromSchema(schema) : {})',
      '\t\t\tsetData(normalizeConditionalActionData(schema, props.data ? props.data : schema ? getDefaultDataFromSchema(schema) : {}, data))',
    ],
    [
      '\t\t\tprevPropsDataJsonRef.current = JSON.stringify(newData)\n\t\t\tsetData(newData)\n\t\t\tprops.setData(newData)',
      '\t\t\tconst normalized = normalizeConditionalActionData(schema, newData, data)\n' +
        '\t\t\tconst json = JSON.stringify(normalized)\n' +
        '\t\t\tprevPropsDataJsonRef.current = json\n' +
        '\t\t\tpublishedDataJsonRef.current = json\n' +
        '\t\t\tif (JSON.stringify(data) !== json) setData(normalized)\n' +
        '\t\t\tif (JSON.stringify(props.data) !== json) props.setData?.(normalized)',
    ],
    ['\t\t[props]\n', '\t\t[props, schema, data]\n'],
    ['\t\tvalidateGDDSchema(schema)', '\t\tvalidateGDDSchema(formSchema)'],
    ['\t\t\t<superflytv-ograf-form\n', '\t\t\t<superflytv-ograf-form\n\t\t\t\tkey={formKey}\n'],
    ['\t\t\t\tschema={JSON.stringify(schema)}', '\t\t\t\tschema={JSON.stringify(formSchema)}'],
    ['\t\t\t\tvalue={JSON.stringify(data)}', '\t\t\t\tvalue={JSON.stringify(normalizedData)}'],
  ];
  for (const [from, to] of replacements) {
    if (formUpdated.split(from).length !== 2)
      throw new Error(
        'Devtool OGrafForm has changed. Review the main data integration before applying.',
      );
    formUpdated = formUpdated.replace(from, to);
  }
} else {
  for (const required of [
    'key={formKey}',
    'normalizeConditionalActionData(schema, newData, data)',
    'schema={JSON.stringify(formSchema)}',
  ])
    if (!formUpdated.includes(required))
      throw new Error(
        'Existing main conditional form integration differs; review before updating.',
      );
}
const originalListener =
  "\t\tif (formRef.current) {\n\t\t\tconst listener = (e) => {\n\t\t\t\tonDataChange(e.detail.value)\n\t\t\t}\n\t\t\tformRef.current.addEventListener('change', listener)\n\t\t\treturn () => formRef.current.removeEventListener('change', listener)\n\t\t}";
const stableListener =
  "\t\tconst form = formRef.current\n\t\tif (form) {\n\t\t\tconst listener = (e) => {\n\t\t\t\tonDataChange(e.detail.value)\n\t\t\t}\n\t\t\tform.addEventListener('change', listener)\n\t\t\treturn () => form.removeEventListener('change', listener)\n\t\t}";
if (formUpdated.includes(originalListener))
  formUpdated = formUpdated.replace(originalListener, stableListener);
else if (!formUpdated.includes(stableListener))
  throw new Error('Devtool form listener has changed; review cleanup before applying.');
const optionalMarker = '// OGraf Studio optional field presence integration';
if (!formUpdated.includes(optionalMarker)) {
  const replacements = [
    [
      "import { resolveConditionalActionSchema, normalizeConditionalActionData } from './conditionalActionSchema.js'",
      optionalMarker +
        "\nimport { resolveConditionalActionSchema, normalizeConditionalActionData, projectOptionalFormSchema, optionalFormFields, setOptionalFormField } from './conditionalActionSchema.js'",
    ],
    [
      '\tconst formSchema = resolveConditionalActionSchema(schema, normalizedData)',
      '\tconst resolvedSchema = resolveConditionalActionSchema(schema, normalizedData)\n' +
        '\tconst optionalFields = optionalFormFields(resolvedSchema, normalizedData)\n' +
        '\tconst formSchema = projectOptionalFormSchema(resolvedSchema, normalizedData)',
    ],
    [
      "\t\t<div className={props.className} style={{ overflow: 'auto', ...props.style }}>\n",
      "\t\t<div className={props.className} style={{ overflow: 'auto', ...props.style }}>\n" +
        '\t\t\t{optionalFields.length > 0 && (\n' +
        '\t\t\t\t<fieldset className="border border-secondary rounded p-2 mb-2" aria-label="Optional fields">\n' +
        '\t\t\t\t\t<legend className="float-none w-auto fs-7 px-1 mb-1">Include fields</legend>\n' +
        '\t\t\t\t\t{optionalFields.map((field) => (\n' +
        '\t\t\t\t\t\t<label key={JSON.stringify(field.path)} className="d-block small mb-1">\n' +
        '\t\t\t\t\t\t\t<input type="checkbox" className="me-2" checked={field.included}\n' +
        '\t\t\t\t\t\t\t\taria-label={`Include ${field.label}`}\n' +
        '\t\t\t\t\t\t\t\tonChange={(event) => onDataChange(setOptionalFormField(normalizedData, field.path, event.target.checked, field.schema))} />\n' +
        '\t\t\t\t\t\t\t{field.label}\n' +
        '\t\t\t\t\t\t</label>\n' +
        '\t\t\t\t\t))}\n' +
        '\t\t\t\t</fieldset>\n' +
        '\t\t\t)}\n',
    ],
  ];
  for (const [from, to] of replacements) {
    if (formUpdated.split(from).length !== 2)
      throw new Error('Devtool optional-field integration target changed; review before applying.');
    formUpdated = formUpdated.replace(from, to);
  }
} else {
  for (const required of [
    'projectOptionalFormSchema(resolvedSchema, normalizedData)',
    'optionalFormFields(resolvedSchema, normalizedData)',
    'setOptionalFormField(normalizedData, field.path, event.target.checked, field.schema)',
  ])
    if (!formUpdated.includes(required))
      throw new Error('Existing optional-field integration differs; review before updating.');
}
const backupDirectory = join(root, '.ograf-studio-integration-backups');
await mkdir(backupDirectory, { recursive: true });
async function backup(name, content, extension) {
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
  const path = join(backupDirectory, `${name}-${hash}.${extension}`);
  try {
    await access(path);
  } catch {
    await writeFile(path, content);
  }
  return path;
}
const backupPath = await backup('GraphicAction', original, 'jsx');
const formBackupPath = await backup('ograf-form', formOriginal, 'jsx');
const previousHelper = await readFile(helperPath, 'utf8').catch(() => undefined);
const helperBackupPath =
  previousHelper === undefined
    ? undefined
    : await backup('conditionalActionSchema', previousHelper, 'js');
await copyFile(sourcePath, helperPath);
await writeFile(componentPath, updated.replaceAll('\n', newline));
await writeFile(formPath, formUpdated.replaceAll('\n', formNewline));
if (args.includes('--refresh-client')) {
  // Upstream emits a stable index.js filename with a long cache lifetime.
  const htmlPath = join(root, 'client/dist/index.html');
  const html = await readFile(htmlPath, 'utf8');
  const entry = /src="\/index\.js(?:\?[^" ]*)?"/;
  if (!entry.test(html)) throw new Error('Devtool build entry changed; review cache refresh.');
  const bundle = await readFile(join(root, 'client/dist/index.js'));
  const version = createHash('sha256').update(bundle).digest('hex').slice(0, 16);
  await writeFile(htmlPath, html.replace(entry, `src="/index.js?ografStudioForms=${version}"`));
}
console.log(
  JSON.stringify(
    {
      checkout: root,
      componentPath,
      helperPath,
      backupPath,
      formPath,
      formBackupPath,
      helperBackupPath,
      refreshedClient: args.includes('--refresh-client'),
      rebuildClient: !args.includes('--refresh-client'),
    },
    null,
    2,
  ),
);
