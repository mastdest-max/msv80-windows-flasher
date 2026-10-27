import { useState } from "react";
import { describeBlock, describeLocal, localPayload, words } from "@/lib/msv/chassis";
import { useSession } from "@/lib/msv/session";

type Reading = { id: string; name: string; module: string; text: string };

const IDLE: Reading[] = [
  { id: "vvt", name: "Valvetronic eccentric shaft", module: "DME", text: "Not read yet. This is the motor position, in degrees once the block scaling is known." },
  { id: "fl", name: "Front left wheel", module: "DSC", text: "Not read yet." },
  { id: "fr", name: "Front right wheel", module: "DSC", text: "Not read yet." },
  { id: "rl", name: "Rear left wheel", module: "DSC", text: "Not read yet." },
  { id: "rr", name: "Rear right wheel", module: "DSC", text: "Not read yet." },
  { id: "vtg-temp", name: "Transfer case temperature", module: "VTG", text: "Not read yet." },
  { id: "vtg-angle", name: "Transfer case actuator", module: "VTG", text: "Not read yet. Degrees of the actuator, once the block scaling is known." },
  { id: "yaw", name: "Yaw rate", module: "DSC", text: "Not read yet." },
  { id: "steer", name: "Steering angle", module: "SZL", text: "Not read yet." },
  { id: "ekps", name: "Fuel pump", module: "EKPS", text: "Not read yet." },
];

export function ChassisPanel() {
  const connected = useSession((state) => state.link !== null);
  const [rows, setRows] = useState<Reading[]>(IDLE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function readOnce() {
    const link = useSession.getState().link;
    if (!link) return;
    setBusy(true);
    setError(null);
    const next = IDLE.map((row) => ({ ...row, text: "No reply." }));
    try {
      const vvtRaw = await link.requestModule(0x12, Uint8Array.of(0x21, 0x0b), 320);
      const vvt = localPayload(vvtRaw, 0x0b);
      next[0].text = vvt === "refused" ? "The DME refused block 0B." : vvt ? describeBlock(vvt, "single") : "No Valvetronic block in the reply.";

      const dscRaw = await link.requestModule(0x29, Uint8Array.of(0x21, 0x01), 320);
      const dsc = localPayload(dscRaw, 0x01);
      if (dsc === "refused") {
        for (let i = 1; i <= 4; i++) next[i].text = "DSC refused block 01.";
      } else if (dsc && dsc.length >= 8) {
        const counts = words(dsc);
        const names = ["Front left", "Front right", "Rear left", "Rear right"];
        for (let i = 0; i < 4; i++) next[i + 1].text = `${names[i]} ${counts[i]} counts. Not km/h yet.`;
      } else if (dsc) {
        const text = describeBlock(dsc, "single");
        for (let i = 1; i <= 4; i++) next[i].text = text;
      }

      const vtgRaw = await link.requestModule(0x19, Uint8Array.of(0x21, 0x01), 320);
      const vtg = localPayload(vtgRaw, 0x01);
      if (vtg === "refused") {
        next[5].text = "VTG refused block 01.";
        next[6].text = "VTG refused block 01.";
      } else if (vtg && vtg.length >= 4) {
        const counts = words(vtg);
        next[5].text = `${counts[0]} counts. Not °C until the scaling is confirmed.`;
        next[6].text = `${counts[1]} counts. Not degrees until the scaling is confirmed.`;
      } else if (vtg) {
        const text = describeBlock(vtg, "single");
        next[5].text = text;
        next[6].text = text;
      }

      const yawRaw = await link.requestModule(0x29, Uint8Array.of(0x21, 0x02), 320);
      next[7].text = describeLocal(yawRaw, 0x02);
      const steerRaw = await link.requestModule(0x34, Uint8Array.of(0x21, 0x01), 320);
      next[8].text = describeLocal(steerRaw, 0x01);
      const pumpRaw = await link.requestModule(0x17, Uint8Array.of(0x21, 0x01), 320);
      next[9].text = describeLocal(pumpRaw, 0x01);
      setRows(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The chassis read stopped.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h2 className="font-medium">Chassis</h2>
      <p className="mt-2 text-sm text-muted">
        Valvetronic is the DME. The four wheel sensors are DSC. Transfer-case temperature and actuator angle are VTG. Counts stay unscaled until a reply confirms the units, so a wrong number is not shown as degrees.
      </p>
      <button
        type="button"
        disabled={!connected || busy}
        className="mt-3 h-11 rounded-md bg-lamp px-3 text-sm font-medium text-bg disabled:opacity-60"
        onClick={() => void readOnce()}
      >
        {busy ? "Reading chassis…" : "Read chassis"}
      </button>
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      <ul className="mt-3 flex flex-col">
        {rows.map((row) => (
          <li key={row.id} className="grid gap-1 border-b border-line py-2 sm:grid-cols-[16rem_5rem_1fr]">
            <span className="text-sm">{row.name}</span>
            <span className="font-mono text-xs text-lamp">{row.module}</span>
            <span className="text-sm text-muted">{row.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
