import { describe, expect, it } from "vitest";
import { ALL_FUNCTIONS, FUNCTION_CATALOG, parseFormula, validateCalls, type Scalar } from "../src";
import { T1, T2, calc, d, type Fixture } from "./helpers";

type Case = [formula: string, expected: Scalar | string, fixture?: Fixture];

const run = (cases: Case[]) => {
  for (const [f, want, fx] of cases) {
    const got = calc(f, fx);
    if (typeof want === "number" && typeof got === "number") expect(got, f).toBeCloseTo(want, 9);
    else expect(got, f).toEqual(want);
  }
};

const nums = (xs: (number | null | string)[]) => xs as Scalar[];
const col = (...xs: Scalar[]) => xs;

describe("operators", () => {
  it("arithmetic, text, comparison, percent, precedence", () => {
    run([
      ["1+2*3", 7],
      ["(1+2)*3", 9],
      ["2^3^2", 64], // left to right like Excel
      ["-2^2", 4], // unary minus binds tighter than ^ (Excel)
      ["10/4", 2.5],
      ["20%", 0.2],
      ["200*20%", 40],
      ['"a"&"b"&1&TRUE', "ab1TRUE"],
      ["1.5&\"\"", "1.5"],
      ["1=1", true],
      ['"abc"="ABC"', true], // text comparison ignores case
      ["1<>2", true],
      ["2>=2", true],
      ['"a"<"b"', true],
      ['1<"a"', true], // numbers sort before text
      ['"a"<TRUE', true], // text before booleans
      ["[x]+1", 1, { cells: { x: null } }], // blank is 0
      ['[x]&"!"', "!", { cells: { x: null } }],
      ["[x]=0", true, { cells: { x: null } }],
      ['[x]=""', true, { cells: { x: null } }],
      ['"5"+1', 6], // numeric text is converted
      ['"abc"+1', "#VALUE!"],
      ['""+1', "#VALUE!"],
      ["1/0", "#DIV/0!"],
      ["[x]/0", "#DIV/0!", { cells: { x: 5 } }],
      ["0^-1", "#NUM!"],
      ["(-8)^0.5", "#NUM!"],
      ["TRUE+1", 2],
      ["#N/A", "#N/A"],
      ["1+#REF!", "#REF!"],
    ]);
  });

  it("applies operators to whole columns (array formulas)", () => {
    const fx: Fixture = { ranges: { "t1.a": col(1, 2, 3), "t1.b": col(10, 20, 30), "t1.s": col("x", "y", "x") } };
    run([
      ["SUM([T1].[a]*[T1].[b])", 140, fx],
      ['SUMPRODUCT(([T1].[s]="x")*[T1].[b])', 40, fx],
      ["SUM([T1].[a]+1)", 9, fx],
      ["COUNTA(FILTER([T1].[a], [T1].[a]>1))", 2, fx],
    ]);
    expect(calc("[T1].[a]+[T2].[a]", { ranges: { "t1.a": col(1, 2), "t2.a": col(1, 2, 3) } })).toBe("#VALUE!");
  });

  it("propagates errors and reports a missing table as #REF!", () => {
    run([
      ["1+(1/0)", "#DIV/0!"],
      ["SUM([T1].[nope])", "#REF!"],
      ['IFERROR(1/0,"fallback")', "fallback"],
      ["ISERROR(1/0)", true],
      ["ISERROR(5)", false],
    ]);
  });
});

describe("logic", () => {
  it("IF, IFS, SWITCH evaluate lazily", () => {
    run([
      ['IF(1>2,"a","b")', "b"],
      ["IF(1>2,5)", false],
      ["IF(TRUE,1,1/0)", 1], // untaken branch never fails
      ['IFS(5>10,"a",5>3,"b",TRUE,"c")', "b"],
      ["IFS(1>2,1)", "#N/A"],
      ['IFS([x]>1000000000,">1 tỷ",[x]>500000000,">500 triệu",[x]>0,"<500 triệu")', ">500 triệu", { cells: { x: 600000000 } }],
      ['SWITCH("b","a",1,"b",2,"c",3)', 2],
      ['SWITCH("z","a",1,"b",2,99)', 99],
      ['SWITCH("z","a",1)', "#N/A"],
      ['SWITCH([s],"WON",1,0)', 1, { cells: { s: "won" } }],
      ["AND(TRUE,1,1)", true],
      ["AND(TRUE,0)", false],
      ["OR(FALSE,0,2)", true],
      ["NOT(TRUE)", false],
      ["XOR(TRUE,TRUE,TRUE)", true],
      ["XOR(TRUE,TRUE)", false],
      ["NA_()", "#NAME?"],
      ["IFERROR(NA_(),1)", 1],
      ["IFNA(#N/A,5)", 5],
      ["IFNA(1/0,5)", "#DIV/0!"],
      ["ISBLANK([x])", true, { cells: { x: null } }],
      ["ISBLANK([x])", false, { cells: { x: "" } }],
      ["ISNUMBER([x])", true, { cells: { x: 3 } }],
      ["ISNUMBER([x])", false, { cells: { x: "3" } }],
      ["ISTEXT([x])", true, { cells: { x: "a" } }],
      ["ISTEXT([x])", false, { cells: { x: 1 } }],
    ]);
  });
});

describe("math", () => {
  it("covers every math function with Excel edge cases", () => {
    run([
      ["SUM(1,2,3)", 6],
      ["SUM([T1].[a])", 6, { ranges: { "t1.a": nums([1, 2, 3, null, "x"]) } }], // text and blanks in a column are ignored
      ["SUM(1,\"2\")", 3],
      ['SUM(1,"abc")', "#VALUE!"],
      ["SUM([x])", 0, { cells: { x: null } }],
      ["PRODUCT(2,3,4)", 24],
      ["SUMPRODUCT([T1].[a],[T1].[b])", 11, { ranges: { "t1.a": col(1, 2), "t1.b": col(3, 4) } }],
      ["ROUND(2.5,0)", 3],
      ["ROUND(-2.5,0)", -3], // halves round away from zero
      ["ROUND(1.005,2)", 1.01],
      ["ROUND(1234.567,-2)", 1200],
      ["ROUND(1234.567,1)", 1234.6],
      ["ROUNDUP(3.2,0)", 4],
      ["ROUNDUP(-3.2,0)", -4],
      ["ROUNDUP(3.14159,2)", 3.15],
      ["ROUNDDOWN(3.9,0)", 3],
      ["ROUNDDOWN(-3.9,0)", -3],
      ["ROUNDDOWN(1395220000/3*4/1000,-2)", 1860200],
      ["INT(-3.2)", -4],
      ["INT(3.9)", 3],
      ["ABS(-5)", 5],
      ["MOD(10,3)", 1],
      ["MOD(-10,3)", 2],
      ["MOD(10,-3)", -2],
      ["MOD(5,0)", "#DIV/0!"],
      ["POWER(2,10)", 1024],
      ["SQRT(16)", 4],
      ["SQRT(-1)", "#NUM!"],
      ["CEILING(2.3,0.5)", 2.5],
      ["CEILING(2.1)", 3],
      ["FLOOR(2.7,0.5)", 2.5],
      ["FLOOR(2.7)", 2],
      ["LOG(100)", 2],
      ["LOG(8,2)", 3],
      ["LOG(0)", "#NUM!"],
      ["EXP(0)", 1],
      ["LN(1)", 0],
      ["SIGN(-7)", -1],
      ["TRUNC(8.97)", 8],
      ["TRUNC(-8.97,1)", -8.9],
    ]);
  });
});

describe("statistics", () => {
  const fx: Fixture = {
    ranges: {
      "t1.n": nums([10, 20, 30, 40, null, "text"]),
      "t1.s": col("POD Express", "POD", "PS", "ps kèm POD", null, "Lost"),
      "t1.v": col(5, 15, 25, 35, 45, 55),
      "t1.d": col(d(2026, 1, 5), d(2026, 1, 20), d(2026, 2, 3), d(2026, 2, 28), null, d(2026, 3, 1)),
    },
  };
  it("basic aggregates", () => {
    run([
      ["COUNT([T1].[n])", 4, fx],
      ["COUNTA([T1].[n])", 5, fx],
      ["COUNTBLANK([T1].[n])", 1, fx],
      ["AVERAGE([T1].[n])", 25, fx],
      ["AVERAGE([T1].[x])", "#DIV/0!", { ranges: { "t1.x": col(null, "a") } }],
      ["MIN([T1].[n])", 10, fx],
      ["MAX([T1].[n])", 40, fx],
      ["MEDIAN([T1].[n])", 25, fx],
      ["MEDIAN(1,3,2)", 2],
      ["PERCENTILE([T1].[v],0.5)", 30, fx],
      ["PERCENTILE([T1].[v],0.25)", 17.5, fx],
      ["QUARTILE([T1].[v],3)", 42.5, fx],
      ["QUARTILE([T1].[v],5)", "#NUM!", fx],
      ["STDEV(2,4,4,4,5,5,7,9)", 2.138089935, fx],
      ["STDEV(1)", "#DIV/0!"],
      ["MODE(1,2,2,3,3,3)", 3],
      ["MODE(1,2,3)", "#N/A"],
      ["RANK(25,[T1].[v])", 4, fx],
      ["RANK(35,[T1].[v],1)", 4, fx],
      ["RANK(999,[T1].[v])", "#N/A", fx],
      ["LARGE([T1].[v],2)", 45, fx],
      ["SMALL([T1].[v],2)", 15, fx],
      ["LARGE([T1].[v],9)", "#NUM!", fx],
      ["COUNTUNIQUE(1,1,2,\"A\",\"a\",\"\")", 3],
    ]);
  });

  it("Excel criteria: equality, operators, wildcards, dates", () => {
    run([
      ['COUNTIF([T1].[s],"POD")', 1, fx],
      ['COUNTIF([T1].[s],"pod")', 1, fx], // case-insensitive
      ['COUNTIF([T1].[s],"POD*")', 2, fx],
      ['COUNTIF([T1].[s],"*POD*")', 3, fx],
      ['COUNTIF([T1].[s],"P?")', 1, fx],
      ['COUNTIF([T1].[s],"<>POD")', 5, fx],
      ['COUNTIF([T1].[s],"<>"&"*POD*")', 3, fx],
      ["COUNTIF([T1].[s],\"=\")", 1, fx], // blank cells
      ['COUNTIF([T1].[s],"<>")', 5, fx],
      ["COUNTIF([T1].[v],\">=25\")", 4, fx],
      ["COUNTIF([T1].[v],\"<\"&25)", 2, fx],
      ["COUNTIF([T1].[v],15)", 1, fx],
      ["COUNTIF([T1].[n],\">20\")", 2, fx], // text and blanks never satisfy a numeric criteria
      ['COUNTIFS([T1].[s],"POD*",[T1].[v],">10")', 1, fx],
      [`COUNTIFS([T1].[d],">="&${d(2026, 2, 1)},[T1].[d],"<="&EOMONTH(${d(2026, 2, 10)},0))`, 2, fx],
      [`COUNTIFS([T1].[d],">="&DATE(2026,1,1),[T1].[d],"<="&EOMONTH(DATE(2026,1,1),0))`, 2, fx],
      ["COUNTIFS([T1].[v],\">10\",[T1].[v],\"<40\")", 3, fx],
      ['SUMIF([T1].[s],"POD*",[T1].[v])', 20, fx],
      ["SUMIF([T1].[v],\">30\")", 135, fx],
      ['SUMIFS([T1].[v],[T1].[s],"<>"&"*POD*",[T1].[v],">20")', 125, fx],
      ['AVERAGEIF([T1].[s],"POD*",[T1].[v])', 10, fx],
      ['AVERAGEIFS([T1].[v],[T1].[s],"PS")', 25, fx],
      ['AVERAGEIFS([T1].[v],[T1].[s],"nothing")', "#DIV/0!", fx],
      ['MINIFS([T1].[v],[T1].[s],"*POD*")', 5, fx],
      ['MAXIFS([T1].[v],[T1].[s],"*POD*")', 35, fx],
      ['MAXIFS([T1].[v],[T1].[s],"nothing")', 0, fx],
      ["SUMIFS([T1].[v],[T1].[s])", "#VALUE!", fx],
      ["SUMIFS([T1].[v],[T2].[a],1)", "#VALUE!", { ranges: { ...fx.ranges, "t2.a": col(1, 2) } }], // different row counts
    ]);
  });

  it("an empty criteria cell counts as 0, numeric text equals the number", () => {
    run([
      ["COUNTIF([T1].[v],[x])", 1, { cells: { x: null }, ranges: { "t1.v": col(0, 1, null) } }],
      ["COUNTIF([T1].[v],5)", 2, { ranges: { "t1.v": col(5, "5", "abc") } }],
      ['COUNTIF([T1].[v],"5")', 2, { ranges: { "t1.v": col(5, "5", "abc") } }],
    ]);
  });
});

describe("text", () => {
  it("covers every text function", () => {
    run([
      ['CONCAT("a",1,TRUE)', "a1TRUE"],
      ['CONCATENATE("PO-",[x])', "PO-123", { cells: { x: 123 } }],
      ['TEXTJOIN(", ",TRUE,"a","","b")', "a, b"],
      ['TEXTJOIN("-",FALSE,"a","","b")', "a--b"],
      ['TEXTJOIN(", ",TRUE,[T1].[s])', "x, y", { ranges: { "t1.s": col("x", null, "y") } }],
      ['LEFT("POD Express",3)', "POD"],
      ['LEFT("abc")', "a"],
      ['LEFT("abc",10)', "abc"],
      ['RIGHT("PO-123",3)', "123"],
      ['RIGHT("abc",0)', ""],
      ['MID("PO-123-A",4,3)', "123"],
      ['MID("abc",0,1)', "#VALUE!"],
      ['LEN("Việt Nam")', 8],
      ['LOWER("POD Ê")', "pod ê"],
      ['UPPER("pod ê")', "POD Ê"],
      ['PROPER("nguyễn văn an")', "Nguyễn Văn An"],
      ['TRIM("  A   B  ")', "A B"],
      ['SUBSTITUTE("a-b-c","-","/")', "a/b/c"],
      ['SUBSTITUTE("a-b-c","-","/",2)', "a-b/c"],
      ['SUBSTITUTE("abc","","x")', "abc"],
      ['REPLACE("PO-123",1,2,"SO")', "SO-123"],
      ['FIND("-","PO-123")', 3],
      ['FIND("x","PO-123")', "#VALUE!"],
      ['FIND("O","POO",3)', 3],
      ['SEARCH("pod","Loại POD")', 6],
      ['SEARCH("p*d","Loại POD")', 6],
      ['SEARCH("zz","abc")', "#VALUE!"],
      ['VALUE("12.5")', 12.5],
      ['VALUE("1,200")', 1200],
      ['VALUE("abc")', "#VALUE!"],
      ['REPT("ab",3)', "ababab"],
      ['EXACT("a","A")', false],
      ['REGEXMATCH("PO-123","^po-[0-9]+$")', true],
      ['REGEXMATCH("xx","^po")', false],
      ['REGEXEXTRACT("PO-123","[0-9]+")', "123"],
      ['REGEXEXTRACT("PO-123","PO-([0-9]+)")', "123"],
      ['REGEXEXTRACT("abc","[0-9]+")', "#N/A"],
      ['REGEXREPLACE("a1b22","[0-9]+","#")', "a#b#"],
      ['REGEXMATCH("a","(")', "#VALUE!"],
    ]);
  });

  it("TEXT formats numbers and dates", () => {
    run([
      ['TEXT(1234.5,"0")', "1235"],
      ['TEXT(1234.5,"0.00")', "1234.50"],
      ['TEXT(1234567.891,"#,##0")', "1,234,568"],
      ['TEXT(1234567.891,"#,##0.00")', "1,234,567.89"],
      ['TEXT(0.256,"0%")', "26%"],
      ['TEXT(0.256,"0.0%")', "25.6%"],
      ['TEXT(5,"000")', "005"],
      [`TEXT(${d(2026, 11, 18)},"dd/mm/yyyy")`, "18/11/2026"],
      [`TEXT(${d(2026, 11, 8)},"yyyy-mm-dd")`, "2026-11-08"],
      [`TEXT(${d(2026, 3, 5)},"mm/yyyy")`, "03/2026"],
      [`TEXT(${d(2026, 3, 5)}+0.5+0.25/24,"dd/mm/yyyy hh:mm")`, "05/03/2026 12:15"],
    ]);
  });
});

describe("dates", () => {
  const tests: Case[] = [
    ["TODAY()", d(2026, 11, 18)],
    ["NOW()", d(2026, 11, 18) + (10.5 / 24)],
    ["DATE(2026,11,18)", d(2026, 11, 18)],
    ["DATE(2026,13,1)", d(2027, 1, 1)],
    ["DATE(2026,2,30)", d(2026, 3, 2)],
    ["DATE(2026,0,1)", d(2025, 12, 1)],
    ['DATEVALUE("18/11/2026")', d(2026, 11, 18)],
    ['DATEVALUE("2026-11-18")', d(2026, 11, 18)],
    ['DATEVALUE("31/02/2026")', "#VALUE!"],
    ["YEAR(DATE(2026,11,18))", 2026],
    ["MONTH(DATE(2026,11,18))", 11],
    ["DAY(DATE(2026,11,18))", 18],
    ["QUARTER(DATE(2026,11,18))", 4],
    ["QUARTER(DATE(2026,3,31))", 1],
    ["WEEKDAY(DATE(2026,11,18))", 4], // Wednesday, Sunday = 1
    ["WEEKDAY(DATE(2026,11,18),2)", 3],
    ["WEEKDAY(DATE(2026,11,22),2)", 7],
    ["WEEKDAY(DATE(2026,11,22),3)", 6],
    ["WEEKNUM(DATE(2026,1,1))", 1],
    ["WEEKNUM(DATE(2026,11,18))", 47],
    ["WEEKNUM(DATE(2026,11,18),2)", 47],
    ["WEEKNUM(DATE(2026,12,31),21)", 53],
    ["WEEKNUM(DATE(2021,1,3),21)", 53],
    ["EOMONTH(DATE(2026,11,18),0)", d(2026, 11, 30)],
    ["EOMONTH(DATE(2026,1,31),1)", d(2026, 2, 28)],
    ["EOMONTH(DATE(2026,1,31),-2)", d(2025, 11, 30)],
    ["EDATE(DATE(2026,1,31),1)", d(2026, 2, 28)],
    ["EDATE(DATE(2026,11,18),3)", d(2027, 2, 18)],
    ["EDATE(DATE(2026,11,18),-12)", d(2025, 11, 18)],
    ["DAYS(DATE(2026,11,18),DATE(2026,11,1))", 17],
    ['DATEDIF(DATE(2026,1,1),DATE(2026,11,18),"D")', 321],
    ['DATEDIF(DATE(2026,1,15),DATE(2026,11,14),"M")', 9],
    ['DATEDIF(DATE(2026,1,15),DATE(2026,11,15),"M")', 10],
    ['DATEDIF(DATE(2020,5,10),DATE(2026,5,9),"Y")', 5],
    ['DATEDIF(DATE(2020,5,10),DATE(2026,11,9),"YM")', 5],
    ['DATEDIF(DATE(2026,1,31),DATE(2026,3,1),"MD")', 1],
    ['DATEDIF(DATE(2026,1,10),DATE(2026,3,5),"MD")', 23],
    ['DATEDIF(DATE(2025,11,20),DATE(2026,11,18),"YD")', 363],
    ['DATEDIF(DATE(2026,5,1),DATE(2026,1,1),"D")', "#NUM!"],
    ['DATEDIF(DATE(2026,1,1),DATE(2026,2,1),"Q")', "#NUM!"],
    ["NETWORKDAYS(DATE(2026,11,16),DATE(2026,11,22))", 5],
    ["NETWORKDAYS(DATE(2026,11,16),DATE(2026,11,22),DATE(2026,11,18))", 4],
    ["WORKDAY(DATE(2026,11,20),1)", d(2026, 11, 23)],
    ["WORKDAY(DATE(2026,11,18),10)", d(2026, 12, 2)],
    ["WORKDAY(DATE(2026,11,23),-1)", d(2026, 11, 20)],
    ["HOUR(NOW())", 10],
    ["MINUTE(NOW())", 30],
    ["DATE(2026,11,18)+30", d(2026, 12, 18)],
    ["DATE(2026,11,18)-DATE(2026,11,1)", 17],
  ];
  it("covers every date function with Excel edge cases", () => run(tests));

  it("NOW and TODAY follow Vietnam time (UTC+7) near midnight", () => {
    // 2026-11-18 17:30 UTC is already 19 Nov 00:30 in Vietnam.
    const late = { now: new Date("2026-11-18T17:30:00Z") };
    expect(calc("TODAY()", late)).toBe(d(2026, 11, 19));
    expect(calc("HOUR(NOW())", late)).toBe(0);
    expect(calc("TODAY()", { now: new Date("2026-11-18T16:59:00Z") })).toBe(d(2026, 11, 18));
  });
});

describe("lookup", () => {
  const fx: Fixture = {
    cells: { k: "B2" },
    ranges: { "t1.code": col("A1", "B2", "C3", "b2"), "t1.name": col("Alpha", "Beta", "Gamma", "Beta 2"), "t1.num": col(10, 20, 30, 40) },
  };
  it("XLOOKUP, VLOOKUP, INDEX, MATCH, XMATCH", () => {
    run([
      ["XLOOKUP([k],[T1].[code],[T1].[name])", "Beta", fx],
      ['XLOOKUP("zz",[T1].[code],[T1].[name],"Chưa có")', "Chưa có", fx],
      ['XLOOKUP("zz",[T1].[code],[T1].[name])', "#N/A", fx],
      ["XLOOKUP([k],[T1].[code],[T1].[name],,0,-1)", "Beta 2", fx], // search from the end
      ["XLOOKUP(25,[T1].[num],[T1].[name],,-1)", "Beta", fx], // exact or next smaller
      ["XLOOKUP(25,[T1].[num],[T1].[name],,1)", "Gamma", fx], // exact or next larger
      ['XLOOKUP("g*",[T1].[name],[T1].[num],,2)', 30, fx], // wildcard
      ['XLOOKUP("g*",[T1].[name],[T1].[num])', "#N/A", fx], // exact mode takes * literally
      ["XLOOKUP([x],[T1].[code],[T1].[name])", "#N/A", { ...fx, cells: { x: null } }], // blank finds nothing
      ["XLOOKUP(20,[T1].[num],[T1].[name])", "Beta", fx],
      ['XLOOKUP("20",[T1].[num],[T1].[name])', "Beta", fx], // numeric text matches the number
      ["VLOOKUP([k],[T1].[code],[T1].[name])", "Beta", fx],
      ["VLOOKUP(25,[T1].[num],[T1].[name],TRUE)", "Beta", fx],
      ["VLOOKUP(5,[T1].[num],[T1].[name],TRUE)", "#N/A", fx],
      ["INDEX([T1].[name],3)", "Gamma", fx],
      ["INDEX([T1].[name],9)", "#REF!", fx],
      ["MATCH([k],[T1].[code],0)", 2, fx],
      ["MATCH(25,[T1].[num])", 2, fx],
      ["MATCH(25,[T1].[num],-1)", 3, fx],
      ["MATCH(\"zz\",[T1].[code],0)", "#N/A", fx],
      ["XMATCH([k],[T1].[code])", 2, fx],
      ["XMATCH([k],[T1].[code],0,-1)", 4, fx],
      ["INDEX([T1].[name],MATCH([k],[T1].[code],0))", "Beta", fx],
    ]);
  });

  it("FILTER, UNIQUE, SORT (a list result is joined with commas)", () => {
    const f2: Fixture = { ranges: { "t1.s": col("b", "a", "b", null, "c"), "t1.n": col(3, 1, 2, 9, 5) } };
    run([
      ["COUNTA(UNIQUE([T1].[s]))", 3, f2],
      ["UNIQUE([T1].[s])", "b, a, c", f2],
      ["SORT([T1].[s])", "a, b, b, c", f2],
      ["SORT([T1].[n],-1)", "9, 5, 3, 2, 1", f2],
      ['TEXTJOIN("+",TRUE,SORT([T1].[s],-1))', "c+b+b+a", f2],
      ["FILTER([T1].[s],[T1].[n]>2)", "b, c", f2],
      ['FILTER([T1].[s],[T1].[n]>100,"không có")', "không có", f2],
      ["FILTER([T1].[s],[T1].[n]>100)", "#N/A", f2],
      ["SUM(FILTER([T1].[n],[T1].[s]=\"b\"))", 5, f2],
    ]);
  });

  it("row info functions", () => {
    run([
      ["ROW_ID()", "row-1"],
      ["ROW_NO()", 7],
      ["CREATED_TIME()", d(2026, 11, 1)],
      ["MODIFIED_TIME()", d(2026, 11, 2)],
    ]);
  });
});

describe("catalog", () => {
  it("has about 100 functions, each with a description and an example that parses and uses valid functions", () => {
    expect(ALL_FUNCTIONS.length).toBeGreaterThanOrEqual(100);
    const names = new Set(ALL_FUNCTIONS.map((f) => f.name));
    expect(names.size).toBe(ALL_FUNCTIONS.length);
    for (const name of [
      "IF", "IFS", "SWITCH", "AND", "OR", "NOT", "XOR", "IFERROR", "IFNA", "ISBLANK", "ISNUMBER", "ISTEXT", "ISERROR",
      "SUM", "PRODUCT", "SUMPRODUCT", "ROUND", "ROUNDUP", "ROUNDDOWN", "INT", "ABS", "MOD", "POWER", "SQRT", "CEILING", "FLOOR", "LOG", "EXP",
      "COUNT", "COUNTA", "COUNTBLANK", "COUNTIF", "COUNTIFS", "SUMIF", "SUMIFS", "AVERAGE", "AVERAGEIF", "AVERAGEIFS", "MIN", "MAX", "MINIFS", "MAXIFS", "MEDIAN", "PERCENTILE", "QUARTILE", "STDEV", "MODE", "RANK", "LARGE", "SMALL", "COUNTUNIQUE",
      "CONCAT", "TEXTJOIN", "LEFT", "RIGHT", "MID", "LEN", "LOWER", "UPPER", "PROPER", "TRIM", "SUBSTITUTE", "REPLACE", "FIND", "SEARCH", "TEXT", "VALUE", "REGEXMATCH", "REGEXEXTRACT", "REGEXREPLACE",
      "TODAY", "NOW", "DATE", "DATEVALUE", "YEAR", "MONTH", "DAY", "QUARTER", "WEEKDAY", "WEEKNUM", "EOMONTH", "EDATE", "DATEDIF", "DAYS", "NETWORKDAYS", "WORKDAY",
      "XLOOKUP", "VLOOKUP", "INDEX", "MATCH", "XMATCH", "FILTER", "UNIQUE", "SORT", "ROW_ID", "ROW_NO", "CREATED_TIME", "MODIFIED_TIME",
    ]) expect(names.has(name), `${name} is in the design list`).toBe(true);
    for (const f of ALL_FUNCTIONS) {
      expect(f.description.length, f.name).toBeGreaterThan(5);
      expect(f.syntax.startsWith(f.name + "("), f.name).toBe(true);
      expect(f.example, f.name).toContain(f.name + "(");
      // Every example parses and calls only functions that exist, with the right argument counts.
      const r = parseFormula(f.example.replace(/\[([^\]]+)\]/g, "[$1]"));
      expect(r.ok, `${f.name}: ${f.example}`).toBe(true);
      if (r.ok) expect(validateCalls(r.ast), `${f.name}: ${f.example}`).toEqual([]);
      expect(f.exampleResult, f.name).not.toBe("");
    }
    expect(FUNCTION_CATALOG).toHaveLength(ALL_FUNCTIONS.length);
    void T1;
    void T2;
  });
});
