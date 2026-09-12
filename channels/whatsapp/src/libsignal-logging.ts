interface ConsoleMethods {
  info(...values: unknown[]): void;
  warn(...values: unknown[]): void;
}

const sensitiveMessages = new Set(["Closing session:", "Opening session:", "Session already closed", "Session already open"]);

export function installLibsignalSessionLogFilter(logger: ConsoleMethods = console): void {
  const info = logger.info.bind(logger);
  const warn = logger.warn.bind(logger);
  logger.info = (...values) => { if (!sensitiveMessages.has(values[0] as string)) info(...values); };
  logger.warn = (...values) => { if (!sensitiveMessages.has(values[0] as string)) warn(...values); };
}
