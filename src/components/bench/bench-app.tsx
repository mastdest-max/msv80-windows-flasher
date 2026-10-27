import { useEffect, useId, useState, type DragEvent } from "react";
import { CircleCheck, Cpu, Search, TriangleAlert, Upload } from "lucide-react";
import { TestsPanel } from "@/components/bench/tests-panel";
import { BusPanel } from "@/components/bench/bus-panel";
import { CodingPanel } from "@/components/bench/coding-panel";
import { RepositoryPanel } from "@/components/bench/repository-panel";
import { Procedure } from "@/components/bench/procedure";
import { CablePanel } from "@/components/bench/cable-panel";
import { LoggerPanel } from "@/components/bench/logger-panel";
import { ReadChoices } from "@/components/bench/read-choices";
import { formatAddress, formatBytes, findQuery, downloadBytes } from "@/lib/msv/format";
import {
  imageFromBinary,
  imageFromIntelText,
  readDroppedFile,
  type LoadedImage,
  type LoadedXdf,
} from "@/lib/msv/load";
import { toIntelHex } from "@/lib/msv/parse";
import { scalarFlashAddress, scalarFromImage } from "@/lib/msv/read-job";
import { syntheticCalibration, syntheticFullShell } from "@/lib/msv/sample";
import { compareXdf } from "@/lib/msv/xdf";
import { explainIdent } from "@/lib/msv/identify";
import type { Report } from "@/lib/msv/analyze";

type Tab = "inspect" | "cable" | "log" | "read" | "bus" | "coding" | "tests" | "repo";
type Focus = { address: number; length: number };

const KIND: Record<Report["readClass"], string> = {
  full: "Full module",
  calibration: "Calibration only",
  partial: "Partial read",
  fragment: "Not a module read",
};

const ROLE: Record<Report["role"], string> = {
  bin: "Binary",
  "0da": "Calibration file",
  "0pa": "Program file",
  hex: "Intel HEX",
  srec: "S-record",
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function BenchApp() {
  const [tab, setTab] = useState<Tab>("cable");
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [xdf, setXdf] = useState<LoadedXdf | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [locked, setLocked] = useState(false);
  const inputId = useId();

  useEffect(() => {
    if (!locked) return;
    const block = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", block);
    return () => window.removeEventListener("beforeunload", block);
  }, [locked]);

  function applyImage(next: LoadedImage) {
    setImage(next);
    const hit = next.report.strings.find((item) => item.notable);
    setFocus(hit ? { address: hit.address, length: Math.min(24, hit.text.length) } : null);
    setTab("inspect");
  }

  async function onFiles(list: FileList | File[]) {
    const files = [...list];
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    await new Promise((resolve) => setTimeout(resolve, 16));
    let message: string | null = null;
    let nextImage: LoadedImage | null = image;
    let nextXdf = xdf;
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = readDroppedFile(file.name, bytes);
      if (result.type === "error") message = result.message;
      else if (result.type === "xdf") nextXdf = result.xdf;
      else nextImage = result.image;
    }
    setBusy(false);
    setError(message);
    setXdf(nextXdf);
    if (nextImage && nextImage !== image) applyImage(nextImage);
    else setTab("inspect");
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    void onFiles(event.dataTransfer.files);
  }

  return (
    <main className="min-h-screen bg-bg text-fg">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 grid-cols-2 gap-0.5 rounded-md bg-lamp p-1.5" aria-hidden="true">
              <span className="bg-bg" />
              <span className="bg-bg/50" />
              <span className="col-span-2 bg-bg" />
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">MSV Bench</h1>
              <p className="text-sm text-muted">Logger, chassis, bus scan, coding trace, repository, or a module read.</p>
            </div>
          </div>
          <div role="tablist" aria-label="Bench sections" className="flex gap-1 overflow-x-auto border-b border-line">
            <TabButton id="cable" current={tab} locked={locked} onSelect={setTab}>
              Cable
            </TabButton>
            <TabButton id="log" current={tab} locked={locked} onSelect={setTab}>
              Logger
            </TabButton>
            <TabButton id="bus" current={tab} locked={locked} onSelect={setTab}>
              Bus
            </TabButton>
            <TabButton id="tests" current={tab} locked={locked} onSelect={setTab}>
              Tests
            </TabButton>
            <TabButton id="coding" current={tab} locked={locked} onSelect={setTab}>
              Coding
            </TabButton>
            <TabButton id="repo" current={tab} locked={locked} onSelect={setTab}>
              Repository
            </TabButton>
            <TabButton id="inspect" current={tab} locked={locked} onSelect={setTab}>
              Inspect
            </TabButton>
            <TabButton id="read" current={tab} locked={locked} onSelect={setTab}>
              How to read
            </TabButton>
          </div>
        </header>

        {locked ? (
          <p className="rounded-lg border border-lamp/40 bg-lamp-dim px-4 py-3 text-sm">
            Stay on this page until this finishes. Leaving now cuts the lead off.
          </p>
        ) : null}

        {tab === "read" ? (
          <Procedure />
        ) : tab === "bus" ? (
          <BusPanel />
        ) : tab === "tests" ? (
          <TestsPanel />
        ) : tab === "coding" ? (
          <CodingPanel onLock={setLocked} />
        ) : tab === "repo" ? (
          <RepositoryPanel />
        ) : tab === "log" ? (
          <LoggerPanel />
        ) : tab === "cable" ? (
          <div className="flex flex-col gap-4">
            <ReadChoices
              scalars={xdf?.info.scalars ?? []}
              regionSize={xdf?.info.regionSize ?? null}
              onOpenLogger={() => {
                if (!locked) setTab("log");
              }}
              onLock={setLocked}
              onCapture={(name, bytes) => {
                const next = imageFromBinary(name, bytes);
                setImage(next);
                const hit = next.report.strings.find((item) => item.notable);
                setFocus(hit ? { address: hit.address, length: Math.min(24, hit.text.length) } : null);
              }}
              onInspect={() => setTab("inspect")}
            />
            <CablePanel onCapture={(name, bytes) => applyImage(imageFromBinary(name, bytes))} />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-12" onDragOver={(event) => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
            <aside className="flex flex-col gap-3 lg:col-span-4">
              <label
                htmlFor={inputId}
                className={cx(
                  "flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
                  over ? "border-lamp bg-lamp-dim" : "border-line bg-surface hover:border-lamp",
                )}
              >
                <Upload className="size-5 text-lamp" aria-hidden="true" />
                <span className="font-medium">Drop a BIN, .0DA, .0PA, or XDF</span>
                <span className="text-sm text-muted">or click to browse. Files stay in this browser.</span>
                <input
                  id={inputId}
                  className="sr-only"
                  type="file"
                  multiple
                  accept=".bin,.0da,.0pa,.hex,.xdf,.xml,.ori,.s19,.srec"
                  onChange={(event) => {
                    const list = event.target.files;
                    if (list) void onFiles(list);
                    event.target.value = "";
                  }}
                />
              </label>

              <div className="grid gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="h-11 rounded-md bg-lamp px-3 text-sm font-medium text-bg disabled:opacity-60"
                  onClick={() => applyImage(imageFromBinary("BENCH_MSV80.1_MK80S_sample.bin", syntheticCalibration(), "0da", 0x1c0000))}
                >
                  Load MSV80.1 calibration
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="h-11 rounded-md border border-line bg-surface px-3 text-sm font-medium disabled:opacity-60"
                  onClick={() => {
                    const bytes = syntheticCalibration();
                    const result = imageFromIntelText(
                      "BENCH_MSV80.1_MK80S_synthetic.0da",
                      toIntelHex(bytes, 0x1c0000),
                      "0da",
                    );
                    if (result.type === "image") applyImage(result.image);
                    else if (result.type === "error") setError(result.message);
                  }}
                >
                  Open that sample as .0DA
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="h-11 rounded-md border border-line bg-surface px-3 text-sm font-medium disabled:opacity-60"
                  onClick={() => {
                    setBusy(true);
                    window.setTimeout(() => {
                      applyImage(imageFromBinary("BENCH_MSV80.1_full_sample.bin", syntheticFullShell(), "bin", 0));
                      setBusy(false);
                    }, 16);
                  }}
                >
                  Load full module sample
                </button>
              </div>

              {image ? (
                <div className="rounded-lg border border-line bg-surface p-3">
                  <p className="truncate font-mono text-sm">{image.name}</p>
                  <p className="mt-1 text-sm text-muted">
                    {ROLE[image.report.role]}
                    {image.report.encoding !== "binary" ? ` · ${image.report.encoding}` : ""}
                    {image.report.hexMeta ? ` · ${image.report.hexMeta.records} records` : ""}
                  </p>
                  <button
                    type="button"
                    className="mt-3 h-11 w-full rounded-md border border-line text-sm"
                    onClick={() => {
                      setImage(null);
                      setFocus(null);
                      setError(null);
                    }}
                  >
                    Clear image
                  </button>
                </div>
              ) : null}

              {xdf ? (
                <div className="rounded-lg border border-line bg-surface p-3">
                  <p className="text-xs tracking-wide text-muted uppercase">Definition</p>
                  <p className="mt-1 text-sm">{xdf.info.title}</p>
                  <button type="button" className="mt-3 h-11 w-full rounded-md border border-line text-sm" onClick={() => setXdf(null)}>
                    Clear XDF
                  </button>
                </div>
              ) : null}

              <p className="text-sm text-muted">
                QK is MSV80, RK is MSV80.1, PP is MSV70. A browser still cannot talk to the car.
              </p>
            </aside>

            <section className="flex min-w-0 flex-col gap-4 lg:col-span-8" aria-busy={busy}>
              {busy ? <p className="text-sm text-lamp">Reading the file…</p> : null}
              {error ? (
                <p className="rounded-lg border border-danger/50 bg-surface px-3 py-2 text-sm text-danger" role="alert">
                  {error}
                </p>
              ) : null}
              {image ? (
                <ReportView
                  image={image}
                  xdf={xdf}
                  focus={focus}
                  onFocus={setFocus}
                />
              ) : (
                <EmptyState hasXdf={xdf} />
              )}
              {xdf && image ? <XdfCard xdf={xdf} report={image.report} /> : null}
              {xdf && !image ? <XdfCard xdf={xdf} report={null} /> : null}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function TabButton({
  id,
  current,
  locked,
  onSelect,
  children,
}: {
  id: Tab;
  current: Tab;
  locked: boolean;
  onSelect: (tab: Tab) => void;
  children: string;
}) {
  const selected = current === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      disabled={locked && !selected}
      className={cx(
        "-mb-px h-11 border-b-2 px-3 text-sm disabled:opacity-40",
        selected ? "border-lamp text-fg" : "border-transparent text-muted",
      )}
      onClick={() => {
        if (!locked) onSelect(id);
      }}
    >
      {children}
    </button>
  );
}

function EmptyState({ hasXdf }: { hasXdf: LoadedXdf | null }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-lamp" aria-hidden="true" />
          <h2 className="font-medium">What this bench can tell you</h2>
        </div>
        <p className="mt-2 text-sm text-muted">
          Drop a file you already read or converted. It looks for the 0049 program string, then says whether the image is a full flash or only a calibration.
          {hasXdf ? " An XDF is loaded — add the BIN it belongs to." : ""}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Fact title="Full read" body="About 2–2.5 MB, with a 0049 id and real data, not a sea of 0xFF." />
        <Fact title="Calibration" body="About 250 KB. That is a converted .0DA: maps only." />
        <Fact title="WinKFP" body="It writes .0PA and .0DA. It does not dump the ECU." />
      </div>
    </div>
  );
}

function Fact({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-line bg-raised p-3">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </div>
  );
}

function ReportView({
  image,
  xdf,
  focus,
  onFocus,
}: {
  image: LoadedImage;
  xdf: LoadedXdf | null;
  focus: Focus | null;
  onFocus: (focus: Focus) => void;
}) {
  const report = image.report;
  const [showAll, setShowAll] = useState(false);
  const [scope, setScope] = useState<"full" | "programs" | "scalars">("full");
  const notable = report.strings.filter((item) => item.notable);
  const visible = showAll ? report.strings : notable.length > 0 ? notable.slice(0, 8) : report.strings.slice(0, 8);
  const scalarRows = xdf?.info.scalars ?? [];
  const facts = explainIdent(image.bytes);

  useEffect(() => {
    setShowAll(false);
    setScope("full");
  }, [image]);

  return (
    <div className="flex flex-col gap-4">
      <div
        className={cx(
          "rounded-lg border px-4 py-3",
          report.tone === "good" && "border-signal/40 bg-signal-dim",
          report.tone === "warn" && "border-lamp/40 bg-lamp-dim",
          report.tone === "bad" && "border-danger/40 bg-surface",
        )}
        aria-live="polite"
      >
        <div className="flex items-center gap-2">
          {report.tone === "good" ? (
            <CircleCheck className="size-4 text-signal" aria-hidden="true" />
          ) : (
            <TriangleAlert className={cx("size-4", report.tone === "bad" ? "text-danger" : "text-lamp")} aria-hidden="true" />
          )}
          <h2 className="font-semibold">{report.title}</h2>
        </div>
        <p className="mt-1 text-sm text-fg">{report.detail}</p>
      </div>

      <div className="rounded-lg border border-line bg-surface px-4 py-3">
        <p className="text-xs tracking-wide text-muted uppercase">What this file is</p>
        <p className="mt-1 text-lg font-semibold">{plainRead(report).label}</p>
        <p className="mt-1 text-sm text-muted">{plainRead(report).plain}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="h-11 rounded-md bg-lamp px-3 text-sm font-medium text-bg"
            onClick={() => downloadBytes(downloadName(image.name, "bin"), image.bytes)}
          >
            Download binary
          </button>
          <button
            type="button"
            className="h-11 rounded-md border border-line px-3 text-sm"
            onClick={() =>
              downloadBytes(
                downloadName(image.name, "hex"),
                new TextEncoder().encode(toIntelHex(image.bytes, report.baseAddress)),
                "text/plain",
              )
            }
          >
            Download Intel HEX
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Inspect depth">
        {(
          [
            ["full", "Full file"],
            ["programs", "Programs only"],
            ["scalars", "Scalars only"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={scope === id}
            className={cx(
              "h-11 rounded-md px-3 text-sm",
              scope === id ? "bg-lamp font-medium text-bg" : "border border-line",
            )}
            onClick={() => setScope(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Size" value={formatBytes(report.byteLength)} />
        <Stat label="Live data" value={`${(report.liveRatio * 100).toFixed(1)}%`} />
        <Stat label="Kind" value={KIND[report.readClass]} />
        <Stat label="Base" value={formatAddress(report.baseAddress)} />
      </dl>

      {scope !== "scalars" ? (
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="text-xs tracking-wide text-muted uppercase">
            {report.program ? (report.alternates.length > 0 ? "Primary program" : "Program") : "Program"}
            <span className="ml-2 normal-case">
              {report.confidence === "high" ? "High confidence" : report.confidence === "medium" ? "Medium confidence" : "Low confidence"}
            </span>
          </p>
          <p className="mt-1 font-mono text-2xl">{report.program?.code ?? "No 0049 id"}</p>
          <p className="mt-1 break-all font-mono text-sm text-muted">{report.program?.example ?? "No program string in this image."}</p>
          <p className="mt-2 text-sm">
            <span className="text-lamp">{report.family ?? "Unknown family"}</span>
            <span className="text-muted"> · {report.engine}</span>
            {report.shorts[0] ? <span className="text-muted"> · {report.shorts[0].id}</span> : null}
            {report.hardware[0] ? <span className="text-muted"> · {report.hardware[0]}</span> : null}
          </p>
          {report.alternates.length > 0 ? (
            <p className="mt-1 text-sm text-muted">Also present: {report.alternates.map((item) => item.code).join(", ")}</p>
          ) : null}
          {scope === "programs" ? (
            <p className="mt-2 text-sm text-muted">Programs only. Maps and the rest of the image stay out of this view.</p>
          ) : null}
        </div>
      ) : null}

      {facts.length > 0 ? (
        <div className="rounded-lg border border-line bg-surface p-4">
          <h3 className="text-sm font-medium">What the DME said</h3>
          <p className="mt-1 text-sm text-muted">Identification replies, translated. This is not the flash.</p>
          <ul className="mt-2 flex flex-col gap-2">
            {facts.map((fact) => (
              <li key={`${fact.label}-${fact.english}`} className="grid gap-1 border-b border-line py-2 sm:grid-cols-[5.5rem_1fr]">
                <span className="font-mono text-xs text-lamp">{fact.label}</span>
                <span className="text-sm">{fact.english}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {scope === "scalars" ? (
        <div className="rounded-lg border border-line bg-surface p-4">
          <h3 className="text-sm font-medium">Scalars</h3>
          {scalarRows.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              Drop the XDF for this DME. One-cell values from that definition are listed here. Maps are not.
            </p>
          ) : (
            <ul className="mt-2 flex max-h-80 flex-col gap-1 overflow-auto">
              {scalarRows.map((scalar) => (
                <li key={`${scalar.address}-${scalar.title}`} className="flex items-baseline justify-between gap-3 border-b border-line py-2 text-sm">
                  <span className="truncate">{scalar.title}</span>
                  <span className="shrink-0 font-mono text-muted">
                    {formatAddress(scalarFlashAddress(scalar.address, xdf?.info.regionSize ?? null))} · {scalarFromImage(image.bytes, report.baseAddress, scalar, xdf?.info.regionSize ?? null)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {scope === "full" ? (
        <>
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">Memory</h3>
              <p className="text-xs text-muted">Empty, partial, dense. Click a block to open it.</p>
            </div>
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
              {report.segments.map((segment) => (
                <button
                  key={segment.index}
                  type="button"
                  aria-label={`Block ${segment.index + 1}, ${Math.round(segment.liveRatio * 100)} percent live`}
                  className={cx(
                    "h-11 rounded-sm",
                    segment.liveRatio < 0.02 && "bg-raised",
                    segment.liveRatio >= 0.02 && segment.liveRatio < 0.2 && "bg-lamp/40",
                    segment.liveRatio >= 0.2 && segment.liveRatio < 0.55 && "bg-lamp",
                    segment.liveRatio >= 0.55 && "bg-signal",
                    focus &&
                      focus.address >= report.baseAddress + segment.start &&
                      focus.address < report.baseAddress + (report.segments[segment.index + 1]?.start ?? report.byteLength) &&
                      "ring-2 ring-fg ring-offset-2 ring-offset-bg",
                  )}
                  onClick={() => onFocus({ address: report.baseAddress + segment.start, length: 0 })}
                />
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Raw letters</h3>
              {report.strings.length > visible.length ? (
                <button type="button" className="h-11 px-2 text-sm text-lamp" onClick={() => setShowAll((value) => !value)}>
                  {showAll ? "Show identifications" : `Show all ${report.strings.length}`}
                </button>
              ) : null}
            </div>
            {visible.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No printable strings.</p>
            ) : (
              <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-auto">
                {visible.map((item) => {
                  const selected = focus?.address === item.address;
                  return (
                    <li key={`${item.address}-${item.text}`}>
                      <button
                        type="button"
                        className={cx("flex w-full items-baseline gap-3 rounded-md px-2 py-2 text-left", selected ? "bg-lamp-dim" : "hover:bg-raised")}
                        onClick={() => onFocus({ address: item.address, length: Math.min(item.text.length, 48) })}
                      >
                        <span className="shrink-0 font-mono text-xs text-lamp">{formatAddress(item.address)}</span>
                        <span className="truncate font-mono text-sm">{item.text}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {report.warnings.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm text-muted">
              {report.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          <HexPane bytes={image.bytes} base={report.baseAddress} focus={focus} />
        </>
      ) : null}
    </div>
  );
}

function plainRead(report: Report): { label: string; plain: string } {
  const size = formatBytes(report.byteLength);
  if (report.synthetic) {
    return report.readClass === "full"
      ? {
          label: "Sample of a full module",
          plain: "2.5 MB with MSV80.1 program MK80S planted in a boot band and a calibration band. The gap is empty on purpose. Not a file from a car.",
        }
      : {
          label: "Sample of a calibration",
          plain: "About 250 KB. Program MK80S, family MSV80.1, engine N51. The map names are labels only. Not a file from a car.",
        };
  }
  if (report.readClass === "full" && report.program) {
    return {
      label: "Full module",
      plain: `${size} matches a whole MSV flash, and a 0049 program is in it. A full read of this module is about 2.5 MB.`,
    };
  }
  if (report.readClass === "full") {
    return {
      label: "Full size, program missing",
      plain: `${size} is long enough to be the whole module, but there is no 0049 program string. Do not treat it as a finished MSV read.`,
    };
  }
  if (report.readClass === "calibration" && report.program) {
    return {
      label: "Calibration only",
      plain: `${size} is a map file, about 250 KB, not the whole module. The boot and program code are not in it.`,
    };
  }
  if (report.readClass === "calibration") {
    return {
      label: "Calibration size, program missing",
      plain: `${size} is the length of a .0DA, but the 0049 id is missing.`,
    };
  }
  if (report.readClass === "partial") {
    return {
      label: "Partial read",
      plain: `${size} is short of a 2.5 MB full module and not a 250 KB calibration. An interrupted read looks like this.`,
    };
  }
  return {
    label: "Not a module read",
    plain: `${size} is too small to be a calibration or a full module.`,
  };
}

function downloadName(name: string, ext: "bin" | "hex"): string {
  const stem = name.replace(/\.[^.]+$/, "") || "dme-read";
  return `${stem}.${ext}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-raised px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 truncate font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}

function XdfCard({ xdf, report }: { xdf: LoadedXdf; report: Report | null }) {
  const compare = report
    ? compareXdf(xdf.info, {
        span: report.byteLength,
        code: report.program?.code ?? null,
        shortId: report.shorts[0]?.id ?? null,
      })
    : null;
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs tracking-wide text-muted uppercase">XDF</p>
      <h3 className="mt-1 font-medium">{xdf.info.title}</h3>
      {xdf.info.author ? <p className="text-sm text-muted">{xdf.info.author}</p> : null}
      <p className="mt-2 text-sm text-muted">
        {xdf.info.tables} tables · {xdf.info.categories} categories
        {xdf.info.regionSize ? ` · region ${formatBytes(xdf.info.regionSize)}` : ""}
        {xdf.info.programs[0] ? ` · ${xdf.info.programs[0].code}` : ""}
      </p>
      {compare ? (
        <ul className={cx("mt-3 flex flex-col gap-1 text-sm", compare.tone === "mismatch" ? "text-danger" : "text-fg")}>
          {compare.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">Drop the BIN or .0DA this definition describes.</p>
      )}
    </div>
  );
}

function HexPane({ bytes, base, focus }: { bytes: Uint8Array; base: number; focus: Focus | null }) {
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [miss, setMiss] = useState(false);
  const rowCount = 12;
  const maxOffset = Math.max(0, bytes.length - 16);

  useEffect(() => {
    if (!focus) return;
    const relative = Math.min(bytes.length, Math.max(0, focus.address - base));
    const aligned = Math.max(0, relative - (relative % 16) - 16 * 3);
    setOffset(Math.min(maxOffset, aligned));
    setMiss(false);
  }, [focus, base, bytes, maxOffset]);

  function search(from: number) {
    const found = findQuery(bytes, query, from);
    if (found < 0) {
      setMiss(true);
      return;
    }
    setMiss(false);
    const aligned = Math.max(0, found - (found % 16) - 16 * 2);
    setOffset(Math.min(maxOffset, aligned));
  }

  const rows = [];
  for (let row = 0; row < rowCount; row++) {
    const start = offset + row * 16;
    if (start >= bytes.length) break;
    const slice = bytes.subarray(start, Math.min(bytes.length, start + 16));
    const cells: { hex: string; letter: boolean }[] = [];
    let english = "";
    for (let i = 0; i < 16; i++) {
      if (i >= slice.length) {
        cells.push({ hex: "  ", letter: false });
        english += " ";
        continue;
      }
      const value = slice[i];
      const letter = value >= 0x20 && value < 0x7f;
      cells.push({ hex: value.toString(16).toUpperCase().padStart(2, "0"), letter });
      english += letter ? String.fromCharCode(value) : "·";
    }
    rows.push({ address: base + start, cells, english });
  }

  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-medium">Hex and English</h3>
        <form
          className="flex min-w-0 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            search(0);
          }}
        >
          <label className="sr-only" htmlFor="hex-query">
            Search hex or text
          </label>
          <input
            id="hex-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="0049 or hex"
            className="h-11 min-w-0 flex-1 rounded-md border border-line bg-bg px-3 font-mono text-sm text-fg"
          />
          <button type="submit" className="inline-flex h-11 items-center gap-1 rounded-md bg-lamp px-3 text-sm font-medium text-bg">
            <Search className="size-4" aria-hidden="true" />
            Find
          </button>
        </form>
      </div>
      {miss ? <p className="mt-2 text-sm text-danger">Not found.</p> : null}
      <input
        type="range"
        className="mt-3 w-full"
        min={0}
        max={maxOffset}
        step={16}
        value={Math.min(offset, maxOffset)}
        aria-label="Hex position"
        onChange={(event) => setOffset(Number(event.target.value))}
      />
      <div className="mt-2 overflow-x-auto">
        <p className="mb-2 text-sm">
          <span className="text-muted">English on this page. </span>
          <span className="font-medium">{englishFrom(rows) || "No readable text in this slice."}</span>
        </p>
        <div className="font-mono text-sm leading-6">
          {rows.map((row) => (
            <div key={row.address} className="grid grid-cols-1 gap-0.5 border-b border-line py-1 sm:grid-cols-[5.5rem_1fr_11rem] sm:gap-3">
              <span className="text-lamp">{formatAddress(row.address).slice(2)}</span>
              <span>
                {row.cells.map((cell, index) => (
                  <span key={`${row.address}-${index}`} className={cell.letter ? "text-fg" : "text-muted"}>
                    {cell.hex}{" "}
                  </span>
                ))}
              </span>
              <span className="tracking-wide">{row.english}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function englishFrom(rows: { english: string }[]): string {
  const words = rows
    .map((row) => row.english)
    .join("")
    .split(/·+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4);
  return [...new Set(words)].slice(0, 8).join("  ·  ");
}
