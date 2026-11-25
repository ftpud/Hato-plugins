export type ElicitationValue = string | number | boolean | string[];
export type ElicitationValues = Record<string, ElicitationValue>;
export interface ElicitationProperty { type?: string; title?: string; description?: string; default?: unknown; enum?: unknown[]; oneOf?: any[]; items?: any;
  minLength?: number; maxLength?: number; pattern?: string; minimum?: number; maximum?: number; minItems?: number; maxItems?: number }
export interface ElicitationSchema { type?: string; title?: string; description?: string; properties?: Record<string, ElicitationProperty>; required?: string[] }

const primitive = (value: unknown): value is ElicitationValue => typeof value === "string" || typeof value === "number" || typeof value === "boolean" || (Array.isArray(value) && value.every(item => typeof item === "string"));
const unsafeKey = (key: string) => key === "__proto__" || key === "prototype" || key === "constructor";
const propertyObject = (value: unknown): value is ElicitationProperty & ElicitationSchema => !!value && typeof value === "object" && !Array.isArray(value);
const fieldTypes = new Set(["string", "boolean", "number", "integer", "array"]);

/** ACP accepts JSON Schema patterns, but the module runtime has no linear-time regex engine.
 * Reject extension/backreference/alternation/group-quantifier forms rather than risking ReDoS. */
function safePattern(pattern: string): RegExp {
  const unsupported = () => { throw new Error("pattern is outside the supported safe subset"); };
  if(pattern.length>200)unsupported();
  let inClass=false,quantifiers=0;
  for(let i=0;i<pattern.length;i++){
    const c=pattern[i];
    if(c==="\\"){
      const escaped=pattern[++i];
      if(!escaped || !"dDsSwW.^$[]{}()+*?\\-".includes(escaped))unsupported();
      continue;
    }
    if(c==="["){if(!inClass)inClass=true;continue;}
    if(c==="]"&&inClass){inClass=false;continue;}
    if(inClass)continue;
    if("()|".includes(c))unsupported();
    if("*+?".includes(c))quantifiers++;
    if(c==="{"){
      const bounded=/^\{(\d+)(?:,(\d+))?\}/.exec(pattern.slice(i));
      if(!bounded || Number(bounded[1])>256 || Number(bounded[2]||bounded[1])>256)unsupported();
      i+=bounded![0].length-1;quantifiers++;
    }
  }
  // One anchored quantifier has linear backtracking; overlapping repeats and optional chains do not.
  if(inClass || quantifiers>1 || quantifiers && (!pattern.startsWith("^")||!pattern.endsWith("$")))unsupported();
  return new RegExp(pattern);
}

function enumValues(property: ElicitationProperty): unknown[] | null {
  if (Array.isArray(property.enum)) return property.enum;
  if (Array.isArray(property.oneOf)) return property.oneOf.map(option => option?.const ?? option?.value);
  return null;
}

export function enumChoices(property: ElicitationProperty): Array<{ value: string; label: string }> {
  if (!propertyObject(property)) return [];
  if (Array.isArray(property.enum)) return property.enum.filter((value): value is string => typeof value === "string").slice(0, 200).map(value => ({ value, label: value }));
  if (Array.isArray(property.oneOf)) return property.oneOf.flatMap(option => {
    const value = option?.const ?? option?.value;
    return typeof value === "string" ? [{ value, label: String(option?.title || option?.label || value) }] : [];
  }).slice(0, 200);
  return [];
}

export function normalizeElicitationSchema(value: unknown): { schema: ElicitationSchema; error: string | null } {
  const empty: ElicitationSchema = { type: "object", properties: {}, required: [] };
  if (!propertyObject(value)) return { schema: empty, error: "The agent did not provide a flat object schema." };
  if (value.type !== undefined && value.type !== "object") return { schema: empty, error: "The elicitation schema must be an object." };
  if (value.properties !== undefined && !propertyObject(value.properties)) return { schema: empty, error: "Schema properties must be an object." };
  if (value.required !== undefined && (!Array.isArray(value.required) || value.required.some(name => typeof name !== "string"))) return { schema: empty, error: "Schema required must be an array of field names." };
  const entries = Object.entries(value.properties || {});
  if (entries.length > 64) return { schema: empty, error: "The form has too many fields." };
  const properties: Record<string, ElicitationProperty> = {};
  let error: string | null = null;
  for (const [key, raw] of entries) {
    if (unsafeKey(key)) { error = `Unsafe field name '${key}' is not supported.`; continue; }
    if (!propertyObject(raw)) { properties[key] = { type: "unsupported" }; error ||= `Field '${key}' has an invalid schema.`; continue; }
    const property = { ...raw };
    if (property.type !== undefined && !fieldTypes.has(property.type)) error ||= `Field '${key}' uses unsupported schema type '${String(property.type)}'.`;
    if (property.pattern !== undefined) {
      if (typeof property.pattern !== "string") error ||= `Field '${key}' has an invalid pattern.`;
      else try { safePattern(property.pattern); } catch (e) { error ||= `Field '${key}': ${(e as Error).message}`; }
    }
    if (typeof property.default === "string" && property.default.length > 16384) error ||= `Field '${key}' has an oversized default.`;
    if (property.type === "array" && property.items !== undefined && !propertyObject(property.items)) error ||= `Field '${key}' has invalid multi-select items.`;
    properties[key] = property;
  }
  const required = (value.required || []) as string[];
  for (const name of required) if (!(name in properties)) error ||= `Required field '${name}' is missing from the schema.`;
  return { schema: { type: "object", title: typeof value.title === "string" ? value.title : undefined, description: typeof value.description === "string" ? value.description : undefined, properties, required }, error };
}

export function initialElicitationValues(schema: ElicitationSchema): ElicitationValues {
  const values: ElicitationValues = {};
  for (const [key, property] of Object.entries(schema?.properties || {}).slice(0, 64)) {
    if (unsafeKey(key) || !propertyObject(property)) continue;
    if (primitive(property.default)) values[key] = property.default;
    else if (property.type === "boolean") values[key] = false;
    else if (property.type === "array") values[key] = [];
    else values[key] = "";
  }
  return values;
}

export function validateElicitation(value: unknown, values: ElicitationValues): { content: Record<string, ElicitationValue>; errors: Record<string, string> } {
  const normalized = normalizeElicitationSchema(value);
  if (normalized.error) return { content: {}, errors: { _schema: normalized.error } };
  const schema = normalized.schema, errors: Record<string, string> = {}, content: Record<string, ElicitationValue> = {};
  const required = new Set(schema.required || []);
  for (const [key, property] of Object.entries(schema.properties || {})) {
    const raw = values[key], label = property.title || key, missing = raw === undefined || raw === "";
    if (required.has(key) && missing) { errors[key] = `${label} is required.`; continue; }
    if (missing && !required.has(key)) continue;
    const allowed = enumValues(property);
    if (property.type === "string") {
      if (typeof raw !== "string") { errors[key] = `${label} must be text.`; continue; }
      if (raw.length > 16384) errors[key] = `${label} is too long.`;
      else if (allowed && !allowed.includes(raw)) errors[key] = `${label} must be one of its declared values.`;
      else if (typeof property.minLength === "number" && raw.length < property.minLength) errors[key] = `${label} must contain at least ${property.minLength} characters.`;
      else if (typeof property.maxLength === "number" && raw.length > property.maxLength) errors[key] = `${label} must contain at most ${property.maxLength} characters.`;
      else if (property.pattern !== undefined) {
        try { if (!safePattern(property.pattern).test(raw)) errors[key] = `${label} has an invalid format.`; }
        catch (e) { errors[key] = `${label} uses an unsupported pattern: ${(e as Error).message}`; }
      }
      if (!errors[key]) content[key] = raw;
    } else if (property.type === "boolean") {
      if (typeof raw !== "boolean") errors[key] = `${label} must be true or false.`;
      else if (allowed && !allowed.includes(raw)) errors[key] = `${label} must be one of its declared values.`;
      else content[key] = raw;
    } else if (property.type === "number" || property.type === "integer") {
      const number = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
      if (!Number.isFinite(number)) errors[key] = `${label} must be a number.`;
      else if (property.type === "integer" && !Number.isInteger(number)) errors[key] = `${label} must be a whole number.`;
      else if (allowed && !allowed.includes(number)) errors[key] = `${label} must be one of its declared values.`;
      else if (typeof property.minimum === "number" && number < property.minimum) errors[key] = `${label} must be at least ${property.minimum}.`;
      else if (typeof property.maximum === "number" && number > property.maximum) errors[key] = `${label} must be at most ${property.maximum}.`;
      else content[key] = number;
    } else if (property.type === "array") {
      if (!Array.isArray(raw) || !raw.every(item => typeof item === "string")) { errors[key] = `${label} must be a list of text choices.`; continue; }
      const choices = enumValues(propertyObject(property.items) ? property.items : {});
      if (!choices) errors[key] = `${label} does not declare supported choices.`;
      else if (raw.some(item => !choices.includes(item))) errors[key] = `${label} contains an unsupported choice.`;
      else if (typeof property.minItems === "number" && raw.length < property.minItems) errors[key] = `${label} requires at least ${property.minItems} selections.`;
      else if (typeof property.maxItems === "number" && raw.length > property.maxItems) errors[key] = `${label} allows at most ${property.maxItems} selections.`;
      else if (raw.length || required.has(key) || primitive(property.default)) content[key] = [...raw];
    } else errors[key] = `${label} uses unsupported schema type '${String(property.type || "unknown")}'.`;
  }
  return { content, errors };
}
