// My Account.
//
// Read only by design: dAdmin owns identity, so a name or password changed
// here would immediately disagree with every other dApp. What this page is
// for is the one thing dAdmin cannot answer - which client engagements you
// hold in dAssure, and in what capacity.
//
// Everything shown comes from /api/tprm/login/me, which the shell has already
// fetched. There is no endpoint of its own.

import React from "react";
import { useAccess } from "./utils/AccessContext";
import "./TPRM_MyAccount.css";

function TPRMMyAccount() {
    const { user, tenants } = useAccess();

    if (!user) return <div className="tprm-loading">Loading your account...</div>;

    return (
        <div className="tprm-page">
            <div className="tprm-page-head">
                <div>
                    <div className="tprm-page-sub">
                        Who you are signed in as, and the client engagements you hold.
                    </div>
                </div>
            </div>

            <div className="tprm-card tprm-account-id">
                <div className="tprm-account-field">
                    <div className="tprm-account-label">Name</div>
                    <div className="tprm-account-value">{user.emp_name}</div>
                </div>
                <div className="tprm-account-field">
                    <div className="tprm-account-label">Email</div>
                    <div className="tprm-account-value">{user.emp_mail_id}</div>
                </div>
                <div className="tprm-account-field">
                    <div className="tprm-account-label">Employee id</div>
                    <div className="tprm-account-value mono">{user.emp_id}</div>
                </div>
                <div className="tprm-account-field">
                    <div className="tprm-account-label">dAdmin access level</div>
                    <div className="tprm-account-value">{user.emp_access_level || "-"}</div>
                </div>
            </div>

            <div className="tprm-card flush" style={{ marginTop: 18, overflowX: "auto" }}>
                <div className="tprm-card-head">
                    <div className="tprm-card-title">Your engagements</div>
                </div>
                <table className="tprm-table">
                    <thead>
                        <tr>
                            <th>Client</th>
                            <th>Code</th>
                            <th>Role</th>
                            <th className="num">Rank</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tenants.map(t => (
                            <tr key={t.tenant_id}>
                                <td style={{ fontWeight: 600 }}>{t.tenant_name}</td>
                                <td className="mono">{t.tenant_code}</td>
                                <td>
                                    {(t.roles || []).map(r => (
                                        <span key={r} className="tprm-chip purple" style={{ marginRight: 5 }}>
                                            {r}
                                        </span>
                                    ))}
                                </td>
                                <td className="num">{t.rank}</td>
                                <td><span className="tprm-chip grey">{t.status}</span></td>
                            </tr>
                        ))}
                        {tenants.length === 0 && (
                            <tr><td colSpan={5} className="tprm-empty">
                                You hold no engagement yet. A Practice Head or Engagement Manager
                                grants these under Users and Roles.
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="tprm-note" style={{ marginTop: 16 }}>
                Your name, email and password are held in dAdmin and are the same across every
                Dolluz Corp app, so they are changed there rather than here. Your role on each
                client above is specific to dAssure and is granted under Users and Roles.
            </div>
        </div>
    );
}

export default TPRMMyAccount;
