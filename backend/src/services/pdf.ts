export const generatePdf = async (payload: Record<string, unknown>) => {
  const content = JSON.stringify(payload, null, 2);
  return Buffer.from(`PDF_PLACEHOLDER\n${content}\n`, "utf8");
};
