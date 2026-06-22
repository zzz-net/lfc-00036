import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import DataImport from "@/pages/DataImport";
import AnomalyWorkbench from "@/pages/AnomalyWorkbench";
import RuleConfig from "@/pages/RuleConfig";
import Statistics from "@/pages/Statistics";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/import" element={<DataImport />} />
          <Route path="/anomalies" element={<AnomalyWorkbench />} />
          <Route path="/rules" element={<RuleConfig />} />
          <Route path="/reports" element={<Statistics />} />
        </Route>
      </Routes>
    </Router>
  );
}
