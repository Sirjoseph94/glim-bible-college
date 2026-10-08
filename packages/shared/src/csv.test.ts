import { describe, expect, it } from "vitest";
import { Csv, parseCsv, toCsv } from "./csv";

describe("toCsv", () => {
  it("writes a header row and quotes only where needed, with CRLF line ends", () => {
    expect(
      toCsv(
        ["name", "note", "count"],
        [
          ["Ada", "plain", 3],
          ["Bola, Jr", 'said "yes"', null],
          ["Chi", "two\nlines", 0],
        ],
      ),
    ).toBe(
      'name,note,count\r\nAda,plain,3\r\n"Bola, Jr","said ""yes""",\r\nChi,"two\nlines",0\r\n',
    );
  });

  it("defuses cells a spreadsheet would run as formulas", () => {
    expect(toCsv(["v"], [["=1+1"], ["+234 803"], ["-x"], ["@cmd"], ["ok"]])).toBe(
      "v\r\n'=1+1\r\n'+234 803\r\n'-x\r\n'@cmd\r\nok\r\n",
    );
  });
});

describe("Csv", () => {
  it("carries the download's file name", () => {
    expect(new Csv("report.csv", "a\r\n")).toMatchObject({ filename: "report.csv", text: "a\r\n" });
  });
});

describe("parseCsv", () => {
  it("reads quoted fields, escaped quotes, embedded commas and line breaks, CRLF or LF", () => {
    expect(parseCsv('a,b,c\r\n1,"two, 2","say ""hi"""\n3,"multi\nline",\n')).toEqual([
      ["a", "b", "c"],
      ["1", "two, 2", 'say "hi"'],
      ["3", "multi\nline", ""],
    ]);
  });

  it("ignores a byte-order mark and blank lines", () => {
    expect(parseCsv("\uFEFFname\r\n\r\nAda\r\n")).toEqual([["name"], ["Ada"]]);
  });

  it("reads back what toCsv writes", () => {
    const rows = [
      ["x", "y"],
      ["1,2", 'q"q'],
      ["", "line\nbreak"],
    ];
    const [headers = [], ...body] = rows;
    expect(parseCsv(toCsv(headers, body))).toEqual(rows);
  });
});
