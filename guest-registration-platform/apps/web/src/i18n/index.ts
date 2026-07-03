import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import fi from "./locales/fi.json";
import sv from "./locales/sv.json";

const savedLang = typeof localStorage !== "undefined" ? (localStorage.getItem("gr-lang") ?? "") : "";
const browserLang = navigator.language.slice(0, 2);
const fallbackLang = ["en", "fi", "sv"].includes(browserLang) ? browserLang : "en";

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fi: { translation: fi }, sv: { translation: sv } },
  lng: savedLang || fallbackLang,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
