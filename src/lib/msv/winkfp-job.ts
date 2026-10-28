export type WinkfpControl = {
  program: string | null;
  calibration: string | null;
  address: number;
  prg: string | null;
  ipo: string | null;
};

/** A WinKFP `.ctl` multiflash file, the same one `winkfpt.exe -batch` reads. */
export function parseWinkfpControl(text: string): WinkfpControl {
  const value = (key: string) => {
    const match = text.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "im"));
    const found = match?.[1]?.trim();
    return found && found.length > 0 ? found : null;
  };
  const raw = value("MF_SG_ADR");
  const address = raw ? Number.parseInt(raw, 16) : 0x12;
  return {
    program: value("MF_PROGRAMM_DATEI"),
    calibration: value("MF_DATEN_DATEI") ?? value("MF_DATA_DATEI"),
    address: Number.isFinite(address) ? address : 0x12,
    prg: value("MF_PSGBD"),
    ipo: value("MF_PABD"),
  };
}
