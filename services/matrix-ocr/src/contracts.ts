export const MATRIX_OCR_PROTOCOL_VERSION = "matrix-ocr-http-v1" as const;

export const SUPPORTED_MEDIA_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/tiff",
] as const;

export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export interface MatrixOcrTableCell {
  row: number;
  column: number;
  row_span: number;
  column_span: number;
  text: string;
}

export interface MatrixOcrTableStructure {
  type: "table";
  rows: number;
  columns: number;
  cells: MatrixOcrTableCell[];
}

export interface MatrixOcrFormulaStructure {
  type: "formula";
  latex: string;
}

export type MatrixOcrBlockStructure =
  | MatrixOcrTableStructure
  | MatrixOcrFormulaStructure;

export interface MatrixOcrBlock {
  block_index: number;
  reading_order: number;
  kind:
    | "text"
    | "title"
    | "list"
    | "table"
    | "image"
    | "chart"
    | "formula"
    | "header"
    | "footer"
    | "page_number"
    | "other";
  text: string;
  bbox: [number, number, number, number] | null;
  confidence: number | null;
  structure: MatrixOcrBlockStructure | null;
}

export interface MatrixOcrPage {
  physical_page_number: number;
  scan_page_number: number | null;
  printed_page_label: string | null;
  width_points: number;
  height_points: number;
  rotation_degrees: 0 | 90 | 180 | 270;
  text: string;
  blocks: MatrixOcrBlock[];
}

export interface MatrixOcrResponse {
  version: typeof MATRIX_OCR_PROTOCOL_VERSION;
  model_version: string;
  pages: MatrixOcrPage[];
}

export interface MatrixOcrProcessInput {
  sourcePath: string;
  mediaType: SupportedMediaType;
  language: string;
  enableTable: boolean;
  enableFormula: boolean;
  signal: AbortSignal;
  workDir: string;
}

export interface MatrixOcrProcessor {
  readonly modelVersion: string;
  checkReady(): Promise<boolean>;
  getCapabilities?(): Promise<{
    tableStructure: boolean;
    formulaStructure: boolean;
  }>;
  process(input: MatrixOcrProcessInput): Promise<MatrixOcrResponse>;
  close(): Promise<void>;
}

export class MatrixOcrProcessorError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
