import { CHASSIS, chassisById, firstEcuKey } from "@/lib/msv/chassis-catalog";

const selectClass = "h-11 w-full rounded-md border border-line bg-bg px-2 text-sm";

export function ChassisEcuSelect({
  chassisId,
  ecuKey,
  onChange,
}: {
  chassisId: string;
  ecuKey: string;
  onChange: (chassisId: string, ecuKey: string) => void;
}) {
  const car = chassisById(chassisId);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm">
        Chassis
        <select
          className={selectClass}
          value={car.id}
          onChange={(event) => {
            const next = event.target.value;
            onChange(next, firstEcuKey(next));
          }}
        >
          {CHASSIS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        ECU
        <select className={selectClass} value={ecuKey} onChange={(event) => onChange(car.id, event.target.value)}>
          {car.groups.map((group) => (
            <optgroup key={group.name} label={group.name}>
              {group.ecus.map((ecu) => (
                <option key={ecu.key} value={ecu.key}>
                  {ecu.id} — {ecu.note}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
    </div>
  );
}
