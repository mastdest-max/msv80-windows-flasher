import { useEffect, useState, type DragEvent } from "react";
import { Upload } from "lucide-react";
import { downloadBytes, formatBytes } from "@/lib/msv/format";
import {
  addRepositoryFile,
  listRepository,
  previewText,
  readRepositoryFile,
  removeRepositoryFile,
  repositoryDownloadUrl,
  repositoryPackUrl,
  type RepoFile,
} from "@/lib/msv/repository";

export function RepositoryPanel() {
  const [files, setFiles] = useState<RepoFile[]>([]);
  const [previewOk, setPreviewOk] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [look, setLook] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  async function refresh() {
    const listed = await listRepository();
    setFiles(listed.files);
    setPreviewOk(listed.preview);
  }

  useEffect(() => {
    void refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not open the repository."));
  }, []);

  async function take(list: File[]) {
    if (list.length === 0) return;
    setBusy(true);
    setError(null);
    const noteText = note;
    const queue = [...list];
    let cursor = 0;
    let done = 0;
    const active = new Map<string, string>();
    const errors: string[] = [];
    const paint = () => {
      const current = [...active.values()][0];
      setProgress(current ? `${done} of ${queue.length} saved · ${current}` : `${done} of ${queue.length} saved`);
    };
    const worker = async () => {
      while (cursor < queue.length) {
        const file = queue[cursor];
        cursor += 1;
        active.set(file.name, file.name);
        paint();
        try {
          await addRepositoryFile(file, noteText, (sent, total) => {
            active.set(file.name, `${file.name} ${formatBytes(sent)} / ${formatBytes(total)}`);
            paint();
          });
        } catch (err) {
          errors.push(`${file.name}: ${err instanceof Error ? err.message : "stopped"}`);
        } finally {
          active.delete(file.name);
          done += 1;
          paint();
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, () => worker()));
      setNote("");
      if (errors.length > 0) setError(errors.slice(0, 3).join(" "));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload stopped.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function open(file: RepoFile) {
    setSelected(file.id);
    setLook(null);
    if (file.size > 4 * 1024 * 1024) {
      setLook("This file is large. Download it instead of previewing the whole thing here.");
      return;
    }
    try {
      const bytes = await readRepositoryFile(file);
      setLook(previewText(bytes).body);
    } catch (err) {
      setLook(err instanceof Error ? err.message : "Could not preview that file.");
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    void take([...event.dataTransfer.files]);
  }

  const current = files.find((file) => file.id === selected) ?? null;
  const pickedFiles = files.filter((file) => picked.includes(file.id) && file.where === "preview");
  const pickedBytes = pickedFiles.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-line bg-surface p-4">
        <h2 className="font-medium">Repository</h2>
        <p className="mt-2 text-sm text-muted">
          Drop several logs, dumps, or archive pieces at once. Up to four upload together, in large pieces, up to 8 GB each. Nothing is written to the car.
        </p>
        {!previewOk ? (
          <p className="mt-2 text-sm">
            This copy has no preview store. Files stay in this browser. Download one and attach it in the chat so it can be used.
          </p>
        ) : null}
        <label className="mt-3 block text-sm">
          Note
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What this file is, and what looked wrong"
            className="mt-1 h-11 w-full rounded-md border border-line bg-bg px-3 text-sm"
          />
        </label>
        <label
          className={`mt-3 flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center ${over ? "border-lamp bg-lamp-dim" : "border-line"}`}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <Upload className="size-5 text-lamp" aria-hidden="true" />
          <span className="text-sm font-medium">{progress ? progress : busy ? "Saving…" : "Drop files, or click to browse"}</span>
          <input
            className="sr-only"
            type="file"
            multiple
            disabled={busy}
            onChange={(event) => {
              const list = event.target.files;
              if (list) void take([...list]);
              event.target.value = "";
            }}
          />
        </label>
        {error ? <p className="mt-3 text-sm">{error}</p> : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Files</h3>
            {files.some((file) => file.where === "preview") ? (
              <button
                type="button"
                className="h-9 rounded-md border border-line px-3 text-sm"
                onClick={() => setPicked(files.filter((file) => file.where === "preview").map((file) => file.id))}
              >
                Select all
              </button>
            ) : null}
          </div>
          {pickedFiles.length > 0 ? (
            <a
              className="mt-3 flex h-11 items-center justify-center rounded-md bg-lamp px-3 text-sm font-medium text-bg"
              href={repositoryPackUrl(pickedFiles.map((file) => file.id))}
              download="repository.zip"
            >
              Download {pickedFiles.length} files · {formatBytes(pickedBytes)}
            </a>
          ) : (
            <p className="mt-2 text-sm text-muted">Tick the files you want, then download them together. The zip is not compressed, so it starts immediately.</p>
          )}
          {files.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nothing stored yet.</p>
          ) : (
            <ul className="mt-2 flex max-h-[28rem] flex-col gap-1 overflow-auto">
              {files.map((file) => (
                <li key={file.id} className={`flex items-start gap-2 rounded-md border px-2 py-2 ${file.id === selected ? "border-lamp bg-lamp-dim" : "border-line"}`}>
                  {file.where === "preview" ? (
                    <input
                      type="checkbox"
                      className="mt-1 size-4"
                      checked={picked.includes(file.id)}
                      aria-label={`Include ${file.name}`}
                      onChange={(event) => {
                        setPicked((currentIds) =>
                          event.target.checked ? [...currentIds, file.id] : currentIds.filter((id) => id !== file.id),
                        );
                      }}
                    />
                  ) : null}
                  <button type="button" className="min-w-0 flex-1 text-left text-sm" onClick={() => void open(file)}>
                    <span className="block truncate font-medium">{file.name}</span>
                    <span className="mt-0.5 block text-muted">
                      {formatBytes(file.size)} · {file.where === "preview" ? "On this preview" : "This browser only"}
                      {file.note ? ` · ${file.note}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <h3 className="text-sm font-medium">{current ? current.name : "Preview"}</h3>
          {current ? (
            <div className="mt-3 flex gap-2">
              {current.where === "preview" ? (
                <a className="inline-flex h-11 items-center rounded-md bg-lamp px-3 text-sm font-medium text-bg" href={repositoryDownloadUrl(current) ?? "#"} download={current.name}>
                  Download
                </a>
              ) : (
                <button
                  type="button"
                  className="h-11 rounded-md bg-lamp px-3 text-sm font-medium text-bg"
                  onClick={() => {
                    void readRepositoryFile(current).then((bytes) => downloadBytes(current.name, bytes));
                  }}
                >
                  Download
                </button>
              )}
              <button
                type="button"
                className="h-11 rounded-md border border-line px-3 text-sm"
                onClick={() => {
                  void removeRepositoryFile(current).then(async () => {
                    setSelected(null);
                    setLook(null);
                    await refresh();
                  });
                }}
              >
                Remove
              </button>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">Select a file to read the text or the first lines of hex.</p>
          )}
          {look ? <pre className="mt-3 max-h-[24rem] overflow-auto whitespace-pre-wrap font-mono text-xs">{look}</pre> : null}
        </div>
      </div>
    </div>
  );
}
