import { CircleCheck, TriangleAlert } from "lucide-react";

const STEPS = [
  {
    title: "Confirm the DME in the car",
    body: "In INPA, open the engine control unit and write down the program (the 0049… string) and the ZB number. MSV80.1 is the N51 unit. It does not have its own PRG or IPO name.",
  },
  {
    title: "WinKFP will not give you a full read",
    body: "WinKFP programs a .0PA and a .0DA. It can show identification. It cannot dump the flash to a BIN. Looking for a “read ECU” button in there is a dead end.",
  },
  {
    title: "Read with a tool that speaks MSV80",
    body: "On the Cable tab, pick one job. Logger is live data only. Programs reads the 0049 id. Scalars reads single values, and uses a loaded XDF for calibration cells. Calibration .0DA and full .BIN try a memory read and stop if the DME asks for a security key. This app does not guess that key and does not flash.",
  },
  {
    title: "Hold the voltage",
    body: "Leave a charger on the car. Don’t lock the laptop, pull the cable, or cycle the ignition while the read is running. A short file full of 0xFF is usually an interrupted read.",
  },
  {
    title: "Judge the file on the Inspect tab",
    body: "A useful full image is about 2–2.5 MB and contains a 0049 program string. A converted .0DA is about 250 KB: maps only, not the whole ECU. If the family comes back unknown, the dump is incomplete or it isn’t an MSV80.",
  },
  {
    title: "Flashing is a separate step",
    body: "There is no MSV80.1.prg. WinKFP uses the MSV80 pair from SP-Daten — often 08MSV80.prg or 14MSV80.prg, and 12MSV80.ipo or 14MSV80.ipo, depending on the daten set. Expert mode will write whatever .0PA and .0DA you point at. The wrong pair, with the signature still closed, can kill the DME. This bench does not flash and does not patch signatures.",
  },
];

export function Procedure() {
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="flex flex-col gap-3 lg:col-span-3">
        <h2 className="text-lg font-semibold">How a full read actually happens</h2>
        <p className="text-sm text-muted">
          An embedded view cannot see the USB lead. On the Cable tab, open the USB window and connect from Chrome or Edge. The processor in the plug only answers when the OBD end is in the car.
        </p>
        <ol className="flex flex-col gap-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="rounded-lg border border-line bg-surface p-4">
              <p className="font-mono text-xs text-lamp">0{index + 1}</p>
              <h3 className="mt-1 font-medium">{step.title}</h3>
              <p className="mt-1 text-sm text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
      <aside className="flex flex-col gap-3 lg:col-span-2">
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center gap-2 text-signal">
            <CircleCheck className="size-4" aria-hidden="true" />
            <h3 className="font-medium text-fg">What a good file shows</h3>
          </div>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-muted">
            <li>Program string such as 0049QK0MI20S or 0049RK0MK80S.</li>
            <li>Full image near 2.50 MB, or a calibration near 250 KB if you only converted a .0DA.</li>
            <li>Live data, not a field of 0x00 or 0xFF.</li>
            <li>The same program INPA reported.</li>
          </ul>
        </div>
        <div className="rounded-lg border border-lamp/40 bg-lamp-dim p-4">
          <div className="flex items-center gap-2 text-lamp">
            <TriangleAlert className="size-4" aria-hidden="true" />
            <h3 className="font-medium text-fg">Family codes</h3>
          </div>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-sm">
            <dt className="text-lamp">QK</dt>
            <dd className="text-fg">MSV80 · N52N</dd>
            <dt className="text-lamp">RK</dt>
            <dd className="text-fg">MSV80.1 · N51</dd>
            <dt className="text-lamp">PP</dt>
            <dd className="text-fg">MSV70 · early N52</dd>
          </dl>
          <p className="mt-3 text-sm text-muted">
            QK and RK can both use a program name like MI20S. The two letters in front of the 0 decide the ECU, not the five-letter program.
          </p>
        </div>
        <p className="text-sm text-muted">
          Stock calibrations by VIN:{" "}
          <a className="text-lamp underline underline-offset-2" href="https://www.bimmerlabs.com/help" target="_blank" rel="noreferrer">
            Bimmerlabs
          </a>
          . OBD read and write for these DMEs:{" "}
          <a className="text-lamp underline underline-offset-2" href="https://www.bimmertuningtools.com/" target="_blank" rel="noreferrer">
            Bimmer Tuning Tools
          </a>
          .
        </p>
      </aside>
    </div>
  );
}
