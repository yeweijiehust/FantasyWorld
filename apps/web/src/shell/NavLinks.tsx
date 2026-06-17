import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export function NavLinks() {
  const { t } = useTranslation();

  return (
    <>
      <Link to="/" className="[&.active]:text-slate-950">
        {t("nav.world")}
      </Link>
      <Link to="/settings" className="[&.active]:text-slate-950">
        {t("nav.settings")}
      </Link>
    </>
  );
}
