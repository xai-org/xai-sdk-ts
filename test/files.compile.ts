import type { operations } from "../src/generated/types.js";
import type {
  FileContentParams,
  FileListParams,
  FileUploadParams,
  InputItem,
} from "../src/index.js";

type Assert<T extends true> = T;
type ListFilesQuery = NonNullable<operations["handle_list_files_request"]["parameters"]["query"]>;

export type ListParamsFitTheQueryContract = Assert<
  FileListParams extends ListFilesQuery ? true : false
>;

export const uploadExamples = [
  { file: new File(["%PDF"], "report.pdf", { type: "application/pdf" }) },
  { file: new Blob(["hello"]), filename: "notes.txt", purpose: "assistants", expires_after: 3_600 },
  { file: new File(["hello"], "draft.txt"), filename: "final.txt" },
] satisfies Array<FileUploadParams>;

// @ts-expect-error A plain Blob needs a filename.
export const unnamedBlob: FileUploadParams = { file: new Blob(["hello"]) };

export const listExample = {
  limit: 100,
  order: "desc",
  sort_by: "filename",
  filter: 'content_type = "pdf"',
} satisfies FileListParams;

// @ts-expect-error `sort_by` accepts only created_at, filename, or size.
export const unknownSort: FileListParams = { sort_by: "name" };

export const contentExample = { format: "text" } satisfies FileContentParams;

export const fileInputExample = {
  role: "user",
  content: [
    { type: "input_text", text: "Summarize this report." },
    { type: "input_file", file_id: "file_1" },
  ],
} satisfies InputItem;
