export type CsvCell = string | number | boolean | null;

/** Cells a spreadsheet would treat as a formula (CSV injection). */
const FORMULA = /^[=+\-@\t\r]/;

function cell(value: CsvCell): string {
  if (value === null) return "";
  let text = String(value);
  if (typeof value === "string" && FORMULA.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC 4180 CSV with a header row and CRLF line ends. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  return [headers, ...rows].map((row) => `${row.map(cell).join(",")}\r\n`).join("");
}

/**
 * Parses RFC 4180 CSV (quoted fields, doubled quotes, embedded commas and line breaks, CRLF or
 * LF). A leading byte-order mark and blank lines are ignored.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const endRow = () => {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
    field = "";
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);
    if (quoted) {
      if (ch === '"' && input.charAt(i + 1) === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") endRow();
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** A CSV download: an API handler returns one instead of a JSON body. */
export class Csv {
  constructor(
    readonly filename: string,
    readonly text: string,
  ) {}
}
