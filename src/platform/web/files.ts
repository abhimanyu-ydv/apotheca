import type { FileAdapter, PrintAdapter } from "../types";

export const webFiles: FileAdapter = {
  canOpen: true,

  async save(filename, contents, mime) {
    const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoking immediately can cancel the download in Safari; one tick is enough.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  open(accept) {
    return new Promise<string | null>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept;

      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => resolve(null);
        reader.readAsText(file);
      };
      // Fires when the picker is dismissed without choosing anything.
      input.oncancel = () => resolve(null);
      input.click();
    });
  },
};

export const webPrinter: PrintAdapter = {
  available: typeof window !== "undefined" && typeof window.print === "function",
  print() {
    window.print();
  },
};
