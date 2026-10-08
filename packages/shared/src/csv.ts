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

/** A CSV download: an API handler returns one instead of a JSON body. */
export class Csv {
  constructor(
    readonly filename: string,
    readonly text: string,
  ) {}
}
