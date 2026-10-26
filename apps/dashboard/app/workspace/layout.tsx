import Link from "next/link";
import type { ReactNode } from "react";
import { WorkspaceBackdrop } from "../../components/workspace/sky/backdrop";
import "./workspace.css";
import { WorkspaceAskProvider } from "../../components/workspace/workspace-ask";
import { PresenceMenu } from "../../components/workspace/presence/presence-menu";

// Only this opted-in surface owns these properties; existing dashboard pages keep their theme.
const restoreSky = `(function(){var r=document.getElementById('arcadia-workspace');if(!r)return;try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')r.dataset.theme=t}catch{}try{var s=JSON.parse(sessionStorage.getItem('sky')||'null');if(s)for(var n of ['--night','--haze','--sky-zenith','--sky-mid','--sky-horizon'])if(typeof s[n]==='string')r.style.setProperty(n,s[n])}catch{}})()`;
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <div id="arcadia-workspace" className="workspace-shell" suppressHydrationWarning>
    <script dangerouslySetInnerHTML={{ __html: restoreSky }} />
    <WorkspaceBackdrop />
    <a className="workspace-skip" href="#workspace-context">Skip to selected context</a>
    <header className="workspace-header"><Link href="/workspace" className="workspace-wordmark">arcadia</Link><span>space for your work</span><Link href="/workspace/feed">Feed</Link><Link href="/">Dashboard</Link><PresenceMenu /></header>
    <WorkspaceAskProvider>{children}</WorkspaceAskProvider>
  </div>;
}
