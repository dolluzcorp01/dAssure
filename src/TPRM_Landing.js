// The role landing: what your role opens the morning on.
//
// Four numbers, and they are not the same four for everybody - a reviewer needs
// their queue, an author needs the library, a Practice Head needs the practice.
// A single fixed set of counts would be the wrong page for five of the six.
//
// Under it, the menu this role can reach. That is a statement about the
// permission matrix, not a shortcut bar: the point is that the navigation is
// derived, so it can be shown back to you and checked.

import React from "react";
import { useNavigate } from "react-router-dom";
import { NAV_ITEMS, navVisible, navLabel } from "./left_navbar";
import { ROLE_INFO } from "./utils/tprmRoles";
import { useAccess } from "./utils/AccessContext";

const pct = n => n + "%";

// [title, subtitle, [[value, label] x 4]] per role, given the counts.
function shapeFor(code, s) {
    const map = {
        PH: [
            "Practice overview",
            `${s.clients} ${s.clients === 1 ? "client" : "clients"}, ${s.thirdParties} third `
            + `${s.thirdParties === 1 ? "party" : "parties"}, ${s.openFindings} open `
            + `${s.openFindings === 1 ? "finding" : "findings"} across the practice.`,
            [[s.clients, "Clients"], [s.thirdParties, "Third parties"],
            [s.users, "Users"], [s.openFindings, "Open findings"]],
        ],
        EM: [
            "My engagements",
            `${s.clients} ${s.clients === 1 ? "client" : "clients"} assigned, `
            + `${s.awaitingIssue} ${s.awaitingIssue === 1 ? "assessment" : "assessments"} approved `
            + "and waiting to be issued.",
            [[s.clients, "My clients"], [s.thirdParties, "Third parties"],
            [s.awaitingIssue, "Awaiting my issue"], [s.openFindings, "Open findings"]],
        ],
        LA: [
            "Review queue",
            s.awaitingReview
                ? `${s.awaitingReview} ${s.awaitingReview === 1 ? "assessment is" : "assessments are"} `
                  + "waiting for your review. Nothing issues without you."
                : "Nothing is waiting for your review. Nothing issues without you.",
            [[s.awaitingReview, "Awaiting review"], [s.sentBack, "Sent back"],
            [s.approvedThisMonth, "Approved this month"], [s.onHold, "On hold"]],
        ],
        AS: [
            "My work",
            `${s.assignedToMe} ${s.assignedToMe === 1 ? "assessment" : "assessments"} assigned to you`
            + (s.dueThisWeek
                ? `. ${s.dueThisWeek} ${s.dueThisWeek === 1 ? "finding is" : "findings are"} due within the week.`
                : "."),
            [[s.assignedToMe, "Assigned to me"], [s.dueThisWeek, "Due this week"],
            [s.awaitingVendor, "Awaiting vendor"], [s.myOpenFindings, "My open findings"]],
        ],
        IA: [
            "Instrument library",
            `${s.instruments} published ${s.instruments === 1 ? "instrument" : "instruments"}, `
            + `${s.drafts} ${s.drafts === 1 ? "draft" : "drafts"} awaiting publication.`,
            [[s.instruments, "Instruments"], [s.questions, "Questions"],
            [s.standards, "Standards"], [s.drafts, "Draft versions"]],
        ],
        CV: [
            "Your programme",
            "Read only view of your own third party risk position.",
            [[s.thirdParties, "Third parties"], [pct(s.tier1Coverage), "Tier 1 coverage"],
            [s.openCritical, "Open critical"], [s.reportsIssued, "Reports issued"]],
        ],
    };
    return map[code] || map.PH;
}

// Gold, blue, green, red - left to right, always. The order is the design, not
// a ranking: it stops four identical cards reading as one block.
const CARD_TOP = ["var(--tprm-gold)", "var(--tprm-blue)", "var(--tprm-green)", "var(--tprm-red)"];

function TPRMLanding({ code, stats }) {
    const navigate = useNavigate();
    const { hasPerm } = useAccess();
    const [title, sub, cards] = shapeFor(code, stats);
    const info = ROLE_INFO[code];
    const reach = NAV_ITEMS.filter(i => navVisible(i, hasPerm, code, false));

    return (
        <>
            <h1 className="tprm-landing-title">{title}</h1>
            <div className="tprm-landing-sub">{sub}</div>

            <div className="tprm-landing-cards">
                {cards.map((c, i) => (
                    <div className="tprm-card tprm-landing-card" key={i}
                        style={{ borderTopColor: CARD_TOP[i] }}>
                        <div className="tprm-landing-n">{c[0]}</div>
                        <div className="tprm-landing-l">{c[1]}</div>
                    </div>
                ))}
            </div>

            <div className="tprm-card">
                <div className="tprm-lab">What this role can reach</div>
                <div className="tprm-landing-reach">
                    {reach.map(item => (
                        <button
                            key={item.to}
                            className="tprm-chip tprm-chip-btn"
                            style={info
                                ? { background: info.color, borderColor: info.color, color: "#fff" }
                                : undefined}
                            onClick={() => navigate(item.to)}
                        >
                            {navLabel(item, code)}
                        </button>
                    ))}
                </div>

                <div className="tprm-note blue" style={{ marginTop: 16 }}>
                    The menu is derived from the permission matrix, not hard coded per role.
                    Your role on the selected client decides it, so switching client can
                    legitimately change the navigation. Permission is checked again in the API on
                    every request, because hiding a menu is not access control.
                </div>

                {hasPerm("client.create") && (
                    <div style={{ marginTop: 18 }}>
                        <button className="tprm-btn gold"
                            onClick={() => navigate("/Clients", { state: { openForm: true } })}>
                            Go to Clients and onboard one
                        </button>
                    </div>
                )}
            </div>
        </>
    );
}

export default TPRMLanding;
