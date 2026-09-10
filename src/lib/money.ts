const fmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const fmtSigned = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
  signDisplay: "always",
});

export function formatARS(value: number): string {
  return fmt.format(value);
}

export function formatARSSigned(value: number): string {
  return fmtSigned.format(value);
}

export function formatUnits(value: number): string {
  return new Intl.NumberFormat("es-AR").format(value);
}
