export const ANIVERSARIO_PIX_COPIA_COLA =
  "00020101021126330014br.gov.bcb.pix0111085085759715204000053039865802BR5914CARLOS G GODRI6013BALNEARIO PIC62070503***63048B2A";

export const ANIVERSARIO_QR_CODE_IMAGE = "/aniversario-qrcode.png";
export const ANIVERSARIO_GIF = "/aniversario.gif";

export const ANIVERSARIO_PATH = "/aniversario";
export const ANIVERSARIO_URL = "https://godri.dev/aniversario";
export const ANIVERSARIO_REF = "aniversario";

const TIMEZONE = "America/Sao_Paulo";

type DateParts = {
  month: number;
  day: number;
  year: number;
};

export function getBrazilDateParts(date = new Date()): DateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

/** Visível de 18 de junho até 18 de julho (inclusive). */
export function isAniversarioSeason(date = new Date()): boolean {
  const { month, day } = getBrazilDateParts(date);

  if (month === 6 && day >= 18) return true;
  if (month === 7 && day <= 18) return true;
  return false;
}

/** 18 de julho — dia do aniversário. */
export function isAniversarioDay(date = new Date()): boolean {
  const { month, day } = getBrazilDateParts(date);
  return month === 7 && day === 18;
}
