declare module "qrcode-terminal" {
  interface Options { small?: boolean; errorCorrectionLevel?: string; }
  export function generate(value: string, options?: Options, callback?: (code: string) => void): void;
  const qrcode: { generate: typeof generate };
  export default qrcode;
}
