import { useEffect, useState } from "react";
import { ChassisEcuSelect } from "@/components/bench/chassis-pick";
import { ecuByKey, firstEcuKey } from "@/lib/msv/chassis-catalog";
import { testsFor, type InpaTest } from "@/lib/msv/inpa-e90";
import { loadInpaJobs } from "@/lib/msv/inpa-jobs";
import { explainIdent } from "@/lib/msv/identify";
import { faultDetail, moduleAwake, readFaultMemory } from "@/lib/msv/modules";
import { useSession } from "@/lib/msv/session";

function hexTarget(target: number) {
  return `0x${target.toString(16).toUpperCase()}`;
}

export function TestsPanel() {
  const connected = useSession((state) => state.link !== null);
  const [chassisId, setChassisId] = useState("E90");
  const [ecuKey, setEcuKey] = useState(() => {
    const preferred = "E90:MSV80";
    return preferred;
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, string[]> | null>(null);
  const selected = ecuByKey(chassisId, ecuKey);
  const tests = testsFor(selected.id, jobs);

  useEffect(() => {
    let live = true;
    void loadInpaJobs()
      .then((next) => {
        if (live) setJobs(next);
      })
      .catch(() => {
        if (live) setJobs(null);
      });
    return () => {
      live = false;
    };
  }, []);

  function pick(nextChassis: string, nextEcu: string) {
    setChassisId(nextChassis);
    setEcuKey(nextEcu || firstEcuKey(nextChassis));
    setResult(null);
  }

  async function run(test: InpaTest) {
    if (test.kind === "blocked" || selected.target == null) return;
    const target = selected.target;
    const link = useSession.getState().link;
    if (!link) return;
    setBusy(true);
    setResult(null);
    try {
      if (test.kind === "obd") {
        const rpm = await link.readObd(0x0c, true);
        const coolant = await link.readObd(0x05, true);
        const volts = await link.readObd(0x42, true);
        const lines = [
          rpm ? `Engine speed ${((rpm.a * 256 + rpm.b) / 4).toFixed(0)} rpm` : "Engine speed: no mode 01 reply.",
          coolant ? `Coolant ${coolant.a - 40} °C` : "Coolant: no mode 01 reply.",
          volts ? `Module voltage ${((volts.a * 256 + volts.b) / 1000).toFixed(1)} V` : "Voltage: no mode 01 reply.",
        ];
        setResult(lines.join("\n"));
      } else if (test.kind === "faults") {
        const faults = await readFaultMemory((payload) => link.requestModule(target, payload, 800));
        setResult(faults.refused ? faultDetail(faults) : faults.codes.length > 0 ? faults.codes.join("\n") : "No stored faults.");
      } else {
        const service = test.kind === "aif" ? 0x86 : 0x80;
        const raw = await link.requestModule(target, Uint8Array.of(0x1a, service), 500);
        if (!moduleAwake(raw) && test.kind !== "aif") {
          setResult(`${selected.id} did not answer at ${hexTarget(target)}.`);
        } else {
          const facts = explainIdent(raw);
          setResult(
            facts.length > 0
              ? facts.map((fact) => `${fact.label}: ${fact.english}`).join("\n")
              : `${selected.id} answered ${test.name}.`,
          );
        }
      }
    } catch (err) {
      setResult(err instanceof Error ? err.message : "The test stopped.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-line bg-surface p-4">
        <h2 className="font-medium">Module tests</h2>
        <p className="mt-2 text-sm text-muted">
          Pick the chassis, then the ECU. The jobs come from that ECU's INPA script. A test is sent only when the script states an address, and jobs that change the module are not sent.
        </p>
        <div className="mt-3">
          <ChassisEcuSelect chassisId={chassisId} ecuKey={selected.key} onChange={pick} />
        </div>
      </div>
      <div className="rounded-lg border border-line bg-surface p-4">
        <h3 className="font-medium">{selected.id}</h3>
        <p className="mt-1 text-sm text-muted">{selected.note}</p>
        <p className="mt-1 font-mono text-sm text-muted">
          {selected.target == null ? "No address in this script" : hexTarget(selected.target)}
        </p>
        {!connected ? <p className="mt-3 text-sm text-muted">Connect the lead on the Cable tab first.</p> : null}
        {selected.target == null ? (
          <p className="mt-3 text-sm">
            This ECU is in the {chassisId} list, but the script does not state a diagnostic address. Nothing is sent to the car.
          </p>
        ) : null}
        <ul className="mt-3 flex flex-col gap-2">
          {tests.map((test) => {
            const blocked = test.kind === "blocked" || selected.target == null;
            return (
              <li key={test.id} className="rounded-md border border-line px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{test.name}</span>
                  <button
                    type="button"
                    disabled={!connected || busy || blocked}
                    className="h-9 rounded-md border border-line px-3 text-sm disabled:opacity-40"
                    onClick={() => void run(test)}
                  >
                    {blocked ? "Not sent" : "Run"}
                  </button>
                </div>
                <p className="mt-1 text-sm text-muted">{test.detail}</p>
              </li>
            );
          })}
        </ul>
        {result ? <p className="mt-3 whitespace-pre-wrap text-sm">{result}</p> : null}
      </div>
    </div>
  );
}
