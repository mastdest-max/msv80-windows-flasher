import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHANNELS, FAST_CHANNEL_IDS, latestOf, logToCsv, sampleLog, type Channel, type LogSession, type Sample } from "@/lib/msv/logger";
import { describeBlock, localPayload, words } from "@/lib/msv/chassis";
import { ChassisPanel } from "@/components/bench/chassis-panel";
import { useSession } from "@/lib/msv/session";

const MAX_SAMPLES = 1200;

const WATCH = [
  { id: "dme", name: "DME", detail: "Engine speed and throttle" },
  { id: "dsc", name: "DSC", detail: "Four wheel speeds", target: 0x29, local: 0x01, kind: "wheels" },
  { id: "yaw", name: "Yaw", detail: "Yaw rate", target: 0x29, local: 0x02, kind: "single" },
  { id: "szl", name: "SZL", detail: "Steering angle", target: 0x34, local: 0x01, kind: "single" },
  { id: "vtg", name: "VTG", detail: "Transfer case temp and angle", target: 0x19, local: 0x01, kind: "case" },
  { id: "ekps", name: "EKPS", detail: "Fuel pump", target: 0x17, local: 0x01, kind: "single" },
] as const;

function formatValue(channel: Channel, value: number | null) {
  if (value == null) return "—";
  return `${value.toFixed(channel.digits)} ${channel.unit}`;
}

function plausible(id: string, value: number, previous: number | null, dt: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (id === "lambda" && value >= 1.99) return false;
  if (id === "commandedLambda" && (value < 0.7 || value > 1.35)) return false;
  if (id === "voltage" && (value < 8 || value > 16.5)) return false;
  if ((id === "o2" || id === "o2b") && (value < 0 || value > 1.3)) return false;
  if ((id === "level" || id === "purge" || id === "egr" || id === "throttleB" || id === "throttleC" || id === "pedalRel") && (value < 0 || value > 100)) return false;
  if (id === "fuelRate" && (value < 0 || value > 80)) return false;
  if ((id === "cat" || id === "cat2") && (value < -40 || value > 1100)) return false;
  if (id === "speed" && previous != null && Math.abs(value - previous) > 15 + Math.max(dt, 0) * 40) return false;
  return true;
}

function download(log: LogSession) {
  const blob = new Blob([logToCsv(log)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = log.source === "sample" ? "msv-sample-log.csv" : "msv-live-log.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function LoggerPanel() {
  const lead = useSession((state) => state.lead);
  const connected = useSession((state) => state.link !== null);
  const [log, setLog] = useState<LogSession>(() => sampleLog());
  const [channelId, setChannelId] = useState("rpm");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [picked, setPicked] = useState<string[]>(["dme"]);
  const [watch, setWatch] = useState<string[]>([]);
  const stopRef = useRef(false);
  const pickedRef = useRef(picked);
  const channelRef = useRef(channelId);
  pickedRef.current = picked;
  channelRef.current = channelId;
  const channel = CHANNELS.find((item) => item.id === channelId) ?? CHANNELS[0];

  useEffect(() => {
    return () => {
      stopRef.current = true;
    };
  }, []);

  async function startLive() {
    const link = useSession.getState().link;
    if (!link || running) return;
    stopRef.current = false;
    setRunning(true);
    setError(null);
    const wantDmeFirst = pickedRef.current.includes("dme");
    if (wantDmeFirst) {
      const problem = await link.prepareDme();
      if (problem) {
        setError(problem);
        setRunning(false);
        return;
      }
    }
    const samples: Sample[] = [];
    const origin = Date.now();
    const liveNote =
      "The checked modules are read together. N52 values are the Test0 measurement blocks: Valvetronic, both VANOS cams, both lambda banks, and injection. DSC fills the four wheel counts. VTG fills clutch temperature, angle, and torque. Those chassis counts stay unscaled.";
    setLog({ source: "live", note: liveNote, samples });
    let misses = 0;
    let carried: Record<string, number | null> = {};
    let painted = 0;
    let tick = 0;
    let packed = false;
    const fast = CHANNELS.filter((item) => item.pid >= 0 && FAST_CHANNEL_IDS.includes(item.id));
    const rest = CHANNELS.filter((item) => item.pid >= 0 && !FAST_CHANNEL_IDS.includes(item.id));
    const locals = CHANNELS.filter((item) => item.local != null);
    let lines: string[] = [];
    const quiet = new Map<string, number>();
    let speedAt = 0;
    while (!stopRef.current) {
      const current = useSession.getState();
      if (!current.link) {
        setError("The lead closed.");
        break;
      }
      tick += 1;
      const selected = pickedRef.current;
      const wantDme = selected.includes("dme");
      const values: Record<string, number | null> = { ...carried };
      let hit = false;
      try {
        if (wantDme) {
          const chart = CHANNELS.find((item) => item.id === channelRef.current) ?? fast[0];
          const others = [...fast.filter((item) => item.id !== chart.id), ...rest];
          if (packed) {
            const asked = [chart, ...fast.filter((item) => item.id !== chart.id)];
            const map = await current.link.readObdGroup(
              asked.map((item) => item.pid),
              current.can500,
            );
            if (map.size < 2) packed = false;
            for (const item of asked) {
              const pair = map.get(item.pid);
              if (!pair) continue;
              const value = item.decode(pair.a, pair.b);
              if (!plausible(item.id, value, carried[item.id] ?? null, 0.02)) continue;
              values[item.id] = value;
              hit = true;
            }
            if (tick % 8 === 0) {
              const pending = [...rest, ...locals].filter((item) => (quiet.get(item.id) ?? 0) < 4);
              const extra = pending.length > 0 ? pending[Math.floor(tick / 8) % pending.length] : undefined;
              if (extra) {
                const value = extra.local != null
                  ? await current.link.readMesswert(extra.local)
                  : await current.link.readObd(extra.pid, current.can500, true).then((more) => (more ? extra.decode(more.a, more.b) : null));
                const age = samples.length ? (Date.now() - origin - samples[samples.length - 1].t) / 1000 : 1;
                if (value != null && plausible(extra.id, value, carried[extra.id] ?? null, extra.id === "speed" ? (Date.now() - origin - speedAt) / 1000 : age)) {
                  values[extra.id] = value;
                  if (extra.id === "speed") speedAt = Date.now() - origin;
                  quiet.set(extra.id, 0);
                } else {
                  quiet.set(extra.id, (quiet.get(extra.id) ?? 0) + 1);
                }
              }
            }
          } else {
            const pair = await current.link.readObd(chart.pid, current.can500, true);
            if (pair) {
              const value = chart.decode(pair.a, pair.b);
              if (plausible(chart.id, value, carried[chart.id] ?? null, 0.02)) {
                values[chart.id] = value;
                hit = true;
              }
            }
            if (tick % 4 === 0) {
              const pending = [...others, ...locals].filter((item) => (quiet.get(item.id) ?? 0) < 4);
              const extra = pending.length > 0 ? pending[Math.floor(tick / 4) % pending.length] : undefined;
              if (extra) {
                const value = extra.local != null
                  ? await current.link.readMesswert(extra.local)
                  : await current.link.readObd(extra.pid, current.can500, true).then((more) => (more ? extra.decode(more.a, more.b) : null));
                if (value != null && plausible(extra.id, value, carried[extra.id] ?? null, extra.id === "speed" ? (Date.now() - origin - speedAt) / 1000 : 1)) {
                  values[extra.id] = value;
                  if (extra.id === "speed") speedAt = Date.now() - origin;
                  quiet.set(extra.id, 0);
                } else quiet.set(extra.id, (quiet.get(extra.id) ?? 0) + 1);
              }
            }
          }
        }
        if (tick === 1 || !wantDme || tick % 8 === 0) {
          const nextLines: string[] = [];
          for (const item of WATCH) {
            if (!("target" in item) || !selected.includes(item.id) || stopRef.current) continue;
            const raw = await current.link.requestModule(item.target, Uint8Array.of(0x21, item.local), 120, true);
            const payload = localPayload(raw, item.local);
            const text = payload === "refused" ? `Refused block ${item.local.toString(16).toUpperCase()}.` : payload ? describeBlock(payload, item.kind) : "No reply.";
            nextLines.push(`${item.name}: ${text}`);
            if (payload && payload !== "refused") {
              hit = true;
              if (item.kind === "wheels" && payload.length >= 8) {
                const [fl, fr, rl, rr] = words(payload);
                values.wheelFl = fl;
                values.wheelFr = fr;
                values.wheelRl = rl;
                values.wheelRr = rr;
              }
              if (item.kind === "case" && payload.length >= 4) {
                const wordsIn = words(payload);
                values.caseTemp = wordsIn[0];
                values.caseAngle = wordsIn[1];
                if (wordsIn.length >= 3) values.clutchTorque = wordsIn[2];
              }
            }
          }
          if (nextLines.length > 0) lines = nextLines;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Log stopped.");
        break;
      }
      if (stopRef.current) break;
      if (!wantDme && !selected.some((id) => WATCH.some((item) => item.id === id && "target" in item))) {
        setError("Pick at least one module.");
        break;
      }
      misses = hit ? 0 : misses + 1;
      carried = values;
      samples.push({ t: Date.now() - origin, values: { ...values } });
      if (samples.length > MAX_SAMPLES) samples.shift();
      const now = Date.now();
      if (now - painted >= 50) {
        painted = now;
        setWatch(lines);
        setLog({ source: "live", note: liveNote, samples: samples.slice() });
      }
      if (misses >= 6) {
        setError(wantDme ? current.link.dmeRefusal() : "No reply from the selected modules. Ignition on, switch on D-CAN.");
        break;
      }
    }
    setWatch(lines);
    setLog({ source: "live", note: liveNote, samples: samples.slice() });
    setRunning(false);
  }

  function stopLive() {
    stopRef.current = true;
  }

  const points = log.samples.map((sample) => ({
    sec: Number((sample.t / 1000).toFixed(2)),
    value: sample.values[channel.id],
  }));
  const span = log.samples.length ? log.samples[log.samples.length - 1].t / 1000 : 0;
  const groups = [...new Set(CHANNELS.map((item) => item.group))];

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-line bg-surface p-4">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-lamp" aria-hidden="true" />
          <h2 className="font-medium">Data logger</h2>
        </div>
        <p className="mt-2 text-sm text-muted">{log.note}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="flex h-11 items-center gap-2 rounded-md border border-line px-3 text-sm">
            Channel
            <select
              className="h-8 max-w-56 bg-surface text-sm"
              value={channel.id}
              onChange={(event) => setChannelId(event.target.value)}
            >
              {groups.map((group) => (
                <optgroup key={group} label={group}>
                  {CHANNELS.filter((item) => item.group === group).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span className="font-mono text-muted">{formatValue(channel, latestOf(log, channel.id))}</span>
          </label>
          <div className="relative">
              <button
                type="button"
                aria-expanded={menu}
                className="h-11 rounded-md border border-line px-3 text-sm"
                onClick={() => setMenu((open) => !open)}
              >
                Modules: {WATCH.filter((item) => picked.includes(item.id)).map((item) => item.name).join(", ")}
              </button>
              {menu ? (
                <div className="absolute z-10 mt-1 w-72 rounded-md border border-line bg-surface p-1 shadow-sm">
                  {WATCH.map((item) => (
                    <label key={item.id} className="flex h-11 items-center gap-2 px-2 text-sm">
                      <input
                        type="checkbox"
                        checked={picked.includes(item.id)}
                        onChange={() =>
                          setPicked((current) => {
                            const has = current.includes(item.id);
                            if (has && current.length === 1) return current;
                            return has ? current.filter((id) => id !== item.id) : [...current, item.id];
                          })
                        }
                      />
                      <span>{item.name}</span>
                      <span className="text-muted">{item.detail}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
            {connected && !running ? (
              <button type="button" className="h-11 rounded-md bg-lamp px-3 text-sm font-medium text-bg" onClick={() => void startLive()}>
                Start live log
              </button>
            ) : null}
            {running ? (
              <button type="button" className="h-11 rounded-md bg-lamp px-3 text-sm font-medium text-bg" onClick={stopLive}>
                Stop
              </button>
            ) : null}
            <button
              type="button"
              className="h-11 rounded-md border border-line px-3 text-sm"
              onClick={() => {
                stopLive();
                setError(null);
                setLog(sampleLog());
              }}
            >
              Open sample log
            </button>
            <button type="button" className="h-11 rounded-md border border-line px-3 text-sm" onClick={() => download(log)}>
              Download CSV
            </button>
          </div>
          {error ? (
            <p className="mt-3 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <p className="mt-3 text-sm text-muted">
            {log.source === "sample" ? "Sample" : "Live"} · {log.samples.length} samples · {span.toFixed(1)} s
            {lead ? ` · ${lead}` : ""}
            {connected ? " · Lead is open." : " · Nothing is connected. This is the sample."}
          </p>
        </div>
        {watch.length > 0 ? (
          <ul className="rounded-lg border border-line bg-surface p-4 text-sm">
            {watch.map((line) => (
              <li key={line} className="border-b border-line py-2 last:border-0">
                {line}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="rounded-lg border border-line bg-surface p-4">
          <h3 className="text-sm font-medium">
            {channel.name}
            <span className="ml-2 font-mono text-muted">{formatValue(channel, latestOf(log, channel.id))}</span>
          </h3>
          <div className="mt-3 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points}>
                <XAxis dataKey="sec" tick={{ fill: "var(--color-muted)", fontSize: 12 }} stroke="var(--color-line)" unit="s" />
                <YAxis tick={{ fill: "var(--color-muted)", fontSize: 12 }} stroke="var(--color-line)" width={44} />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-line)",
                    color: "var(--color-fg)",
                  }}
                  formatter={(value) => [typeof value === "number" ? value.toFixed(channel.digits) : "—", channel.unit]}
                />
                <Line type="monotone" dataKey="value" stroke="var(--color-lamp)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      <ChassisPanel />
    </div>
  );
}
