import { useState, useEffect } from "react";
import { InstanceList } from "./InstanceList";
import { DeployForm, type TerraformDeployInputsPrefill } from "./DeployForm";
import { Settings } from "./Settings";
import styles from "./App.module.css";

export type Tab = "instances" | "deploy" | "settings";

export interface InstanceItem {
  id: string;
  name: string;
  orchestrator: "terraform" | "kubernetes" | "manual";
  provider?: "aws" | "vultr";
  workspace?: string;
  namespace?: string;
  url?: string;
  publicIp?: string;
  publicDns?: string;
  setupUrl?: string;
  status?: string;
  tracked?: boolean;
  harborfm_repo?: string;
  harborfm_branch?: string;
  script_url?: string;
  instanceGone?: boolean;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("instances");
  const [instances, setInstances] = useState<InstanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<{ orchestrator?: string; provider?: string }>({});
  const [deployPrefill, setDeployPrefill] = useState<TerraformDeployInputsPrefill | null>(null);

  const fetchInstances = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter.orchestrator) params.set("orchestrator", filter.orchestrator);
      if (filter.provider) params.set("provider", filter.provider);
      const res = await fetch(`/api/instances?${params}`);
      const data = await res.json();
      setInstances(data.instances ?? []);
    } catch (e) {
      console.error(e);
      setInstances([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInstances();
  }, [filter.orchestrator, filter.provider]);

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.headerContainer}>
          <div>
            <h1 className={styles.title}>HarborFM Instance Manager</h1>
          </div>
          <nav className={styles.nav}>
            <button
              type="button"
              onClick={() => setTab("instances")}
              className={tab === "instances" ? styles.navBtnActive : styles.navBtn}
            >
              Instances
            </button>
            <button
              type="button"
              onClick={() => setTab("deploy")}
              className={tab === "deploy" ? styles.navBtnActive : styles.navBtn}
            >
              Deploy
            </button>
            <button
              type="button"
              onClick={() => setTab("settings")}
              className={tab === "settings" ? styles.navBtnActive : styles.navBtn}
            >
              Settings
            </button>
          </nav>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.card}>
          {tab === "instances" && (
            <InstanceList
              instances={instances}
              loading={loading}
              filter={filter}
              onFilterChange={setFilter}
              onRefresh={fetchInstances}
              onDuplicateInputs={(inputs: TerraformDeployInputsPrefill) => {
                setDeployPrefill(inputs);
                setTab("deploy");
              }}
            />
          )}
          {tab === "deploy" && (
            <DeployForm
              onDeployed={fetchInstances}
              prefill={deployPrefill}
              onClearPrefill={() => setDeployPrefill(null)}
            />
          )}
          {tab === "settings" && <Settings />}
        </div>
      </main>
    </div>
  );
}
