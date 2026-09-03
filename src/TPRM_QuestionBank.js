import React, { useEffect, useRef, useState, useCallback } from "react";
import { apiJson, apiPost, apiPut, apiDelete, apiUpload, apiDownload } from "./utils/api";
import { FaPlus, FaPen, FaTrash, FaArrowUp, FaArrowDown, FaCog } from "react-icons/fa";
import QuestionEditRow, { blankQuestion, questionToForm, rowReady } from "./TPRM_QuestionRow";
import TPRMInstrumentManager from "./TPRM_InstrumentManager";
import { useAccess } from "./utils/AccessContext";
import { tprmAlert } from "./utils/tprmAlert";
import "./TPRM_QuestionBank.css";
import TPRMSelect from "./TPRM_Select";

function TPRMQuestionBank() {
    const { hasPerm } = useAccess();
    const [sectors, setSectors] = useState([]);
    const [sector, setSector] = useState("GENERIC");
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(false);
    /* One row is editable at a time: { key, qType, form } where key is a
       question_id, or "new". Editing in place rather than in a modal, because
       authoring is a long list rather than a series of separate decisions. */
    // Keyed by question type. A single row state meant starting a control
    // question silently discarded a tiering row someone was part way through
    // typing - two separate jobs on one screen, so each holds its own.
    const [rows, setRows] = useState({ tiering: null, control: null });
    const rowOf = (t) => rows[t];
    const putRow = (t, v) => setRows(r => ({ ...r, [t]: v }));
    const [dimensions, setDimensions] = useState([]);
    const [domains, setDomains] = useState([]);
    const [managing, setManaging] = useState(false);
    // { id, text } while a draft's change note is being edited.
    const [noteEdit, setNoteEdit] = useState(null);

    const loadSectors = useCallback(() => {
        apiJson("/api/tprm/library/sectors").then(setSectors).catch(() => {});
    }, []);

    useEffect(() => { loadSectors(); }, [loadSectors]);

    // Both lists are small and never change, so they are fetched once rather
    // than each time a row opens.
    useEffect(() => {
        apiJson("/api/tprm/library/dimensions").then(setDimensions).catch(() => {});
        apiJson("/api/tprm/library/domains").then(setDomains).catch(() => {});
    }, []);

    /* Which version the questions below belong to. The route has always
       accepted ?versionId; nothing ever sent one, so clicking a row in the
       versions table did nothing and the questions silently stayed on the
       published one. */
    const [versionId, setVersionId] = useState(null);

    // True while a fetch is in flight over content that is already on screen.
    const [refreshing, setRefreshing] = useState(false);

    /* Blanking the card on every fetch is right when the instrument changes -
       the old questions belong to a different instrument and showing them
       while the new ones arrive would be a lie. It is wrong when only the
       version changes, or after saving a question: the card is already showing
       this instrument, so it stays put and the new content replaces it in
       place. Otherwise every click flashed the whole panel. */
    const load = useCallback(() => {
        if (!sector) return;
        setRefreshing(true);
        apiJson(`/api/tprm/library/instruments/${sector}`
            + (versionId ? `?versionId=${versionId}` : ""))
            .then(setData)
            .catch(() => setData(null))
            .finally(() => setRefreshing(false));
    }, [sector, versionId]);

    /* Only a change of instrument clears what is on screen first. The version
       id goes with it: it belongs to one instrument, and asking the server for
       a version that is not in the new list would fall back to the published
       one anyway, with the versions table marking a row that is not there. */
    useEffect(() => { setData(null); setVersionId(null); }, [sector]);

    useEffect(() => { load(); }, [load]);

    const newDraft = async () => {
        const note = await tprmAlert.reason(
            "Create a draft version", "What is changing in this version?", 5);
        if (!note) return;
        setBusy(true);
        try {
            await apiPost(`/api/tprm/library/instruments/${sector}/draft`, { changeNote: note });
            tprmAlert.success("Draft created", "Edit it, then publish when you are ready.");
            load();
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const publish = async (v) => {
        const ok = await tprmAlert.confirm(
            `Publish version ${v.version_no}?`,
            "The current published version retires. Assessments already under way keep the version they started on.",
            "Yes, publish");
        if (!ok) return;
        setBusy(true);
        try {
            const r = await apiPost(`/api/tprm/library/instruments/version/${v.instrument_version_id}/publish`, {});
            tprmAlert.success("Published", r.message);
            load();
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    /* Everything below only ever acts on a draft. The server refuses anything
       else with VERSION_FROZEN, so this is about not offering the button rather
       than about enforcement. */
    const bulkRef = useRef(null);
    const [bulkBusy, setBulkBusy] = useState(null);   // "dl" | "up" | "commit"
    const [preview, setPreview] = useState(null);
    const [pendingFile, setPendingFile] = useState(null);

    const draft = data && (data.versions || []).find(v => v.status === "draft");

    /* Download, fill, import, review, confirm. The preview call and the commit
       call are the same endpoint - commit=1 is the only difference - so what
       you approved is exactly what gets written. */
    const downloadTemplate = async () => {
        if (!draft) return;
        setBulkBusy("dl");
        try {
            await apiDownload(
                `/api/tprm/library/instruments/version/${draft.instrument_version_id}/question-template`,
                `Questions_${sector}.xlsx`);
        } catch (e) { tprmAlert.apiError(e); } finally { setBulkBusy(null); }
    };

    const previewImport = async (file) => {
        if (!draft) return;
        setBulkBusy("up"); setPreview(null);
        try {
            const r = await apiUpload(
                `/api/tprm/library/instruments/version/${draft.instrument_version_id}/questions/import`,
                file);
            setPendingFile(file);
            setPreview(r);
        } catch (e) { tprmAlert.apiError(e); } finally { setBulkBusy(null); }
    };

    const commitImport = async () => {
        if (!draft || !pendingFile) return;
        setBulkBusy("commit");
        try {
            const r = await apiUpload(
                `/api/tprm/library/instruments/version/${draft.instrument_version_id}/questions/import?commit=1`,
                pendingFile);
            tprmAlert.success(
                `${r.imported} ${r.imported === 1 ? "question" : "questions"} imported`,
                "Review them below, then publish the version when you are happy.");
            setPreview(null); setPendingFile(null);
            load();
        } catch (e) { tprmAlert.apiError(e); } finally { setBulkBusy(null); }
    };
    /* Authoring belongs to the version on screen, not to the instrument. Now
       that a retired version can be opened, "there is a draft somewhere" is no
       longer a good enough reason to show an Edit column against v1 - the edit
       would land in the draft, which is not the version being looked at. */
    const mayAuthor = hasPerm("instrument.author")
        && !!data && !!data.current && data.current.status === "draft";

    const discardDraft = async () => {
        const ok = await tprmAlert.confirm(
            `Discard draft v${draft.version_no}?`,
            "Everything authored in it goes with it. The published version is untouched.",
            "Yes, discard it");
        if (!ok) return;
        setBusy(true);
        try {
            await apiDelete(`/api/tprm/library/instruments/version/${draft.instrument_version_id}`);
            tprmAlert.success("Draft discarded");
            load();
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };


    const startAdd = (qType) => putRow(qType, { key: "new", qType, form: blankQuestion() });
    const startEdit = (q) => putRow(q.q_type,
        { key: q.question_id, qType: q.q_type, form: questionToForm(q) });

    const setRowForm = (qType, fn) => setRows(r => (
        r[qType] ? { ...r, [qType]: { ...r[qType], form: fn(r[qType].form) } } : r));

    const saveRow = async (qType) => {
        const row = rows[qType];
        if (!row || !rowReady(row.qType, row.form)) return;
        setBusy(true);
        try {
            const body = { qType: row.qType, ...row.form };
            if (row.key === "new") {
                await apiPost(
                    `/api/tprm/library/instruments/version/${draft.instrument_version_id}/questions`,
                    body);
                // Leave a fresh row open so the next question is one keystroke
                // away. That is the whole reason this is not a modal.
                putRow(qType, { key: "new", qType, form: blankQuestion() });
            } else {
                await apiPut(`/api/tprm/library/questions/${row.key}`, body);
                putRow(qType, null);
            }
            load();
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const saveNote = async () => {
        if (!noteEdit || noteEdit.text.trim().length < 5) return;
        setBusy(true);
        try {
            await apiPut(`/api/tprm/library/instruments/version/${noteEdit.id}`,
                { changeNote: noteEdit.text.trim() });
            setNoteEdit(null);
            load();
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    const removeQuestion = async (q) => {
        const ok = await tprmAlert.confirm(
            `Delete ${q.q_ref}?`,
            "It is removed from this draft only. Versions already published keep it.",
            "Yes, delete it");
        if (!ok) return;
        setBusy(true);
        try {
            await apiDelete(`/api/tprm/library/questions/${q.question_id}`);
            load();
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    /* Move one question within its own list. The two lists are ordered
       independently, so a tiering question never displaces a control one. */
    const move = async (q, list, delta) => {
        const i = list.findIndex(x => x.question_id === q.question_id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= list.length) return;
        const ids = list.map(x => x.question_id);
        [ids[i], ids[j]] = [ids[j], ids[i]];
        setBusy(true);
        try {
            await apiPut(
                `/api/tprm/library/instruments/version/${draft.instrument_version_id}/order`,
                { questionIds: ids });
            load();
        } catch (e) { tprmAlert.apiError(e); } finally { setBusy(false); }
    };

    /* The three actions every question row carries, in the same order and
       position on both tables. */
    const rowActions = (q, list) => (
        <td>
            <div className="tprm-rowacts">
                <button className="tprm-iconbtn" title={`Edit ${q.q_ref}`}
                    onClick={() => startEdit(q)}><FaPen /></button>
                <button className="tprm-iconbtn" title="Move up" disabled={busy}
                    onClick={() => move(q, list, -1)}><FaArrowUp /></button>
                <button className="tprm-iconbtn" title="Move down" disabled={busy}
                    onClick={() => move(q, list, 1)}><FaArrowDown /></button>
                <button className="tprm-iconbtn danger" title={`Delete ${q.q_ref}`} disabled={busy}
                    onClick={() => removeQuestion(q)}><FaTrash /></button>
            </div>
        </td>
    );

    const tiering = data ? data.questions.filter(q => q.q_type === "tiering") : [];
    const controls = data ? data.questions.filter(q => q.q_type === "control") : [];

    /* Both halves or nothing. The tiering set decides a supplier's tier; the
       control set is what that supplier is then asked. An instrument missing
       either cannot carry an assessment through, and publishing is the one
       act on this screen that cannot be taken back. */
    const publishable = tiering.length > 0 && controls.length > 0;
    const publishBlocker = publishable ? null
        : !tiering.length && !controls.length
            ? "Add tiering and control questions before publishing"
            : !tiering.length
                ? "Add at least one tiering question before publishing"
                : "Add at least one control question before publishing";

    return (
        <div className="tprm-page">
            <div className="tprm-page-head">
                <div>
                    <div className="tprm-page-sub">
                        A published version is immutable. To change a question, create a draft,
                        edit it, and publish. Reports already issued never change underneath you.
                    </div>
                </div>
                <div className="tprm-page-actions">
                    {hasPerm("instrument.publish") && (
                        <button className="tprm-btn sm" onClick={() => setManaging(true)}>
                            <FaCog style={{ marginRight: 6 }} />Manage instruments
                        </button>
                    )}
                    {/* 36 instruments, most of them unpublished. The hint carries
                        the state so the label stays readable, and the filter is
                        the only way to reach one by name. */}
                    <TPRMSelect
                        style={{ width: 300 }}
                        value={sector} onChange={setSector}
                        ariaLabel="Instrument"
                        options={sectors.map(s => ({
                            value: s.sector_code,
                            label: s.sector_name,
                            /* Three different states, and they were all reading
                               as one. Nothing authored at all is a different
                               problem from questions written but not yet
                               published, and only the first needs someone to
                               go and write thirty questions. */
                            hint: !Number(s.questions)
                                ? "no questions yet"
                                : s.published_versions
                                    ? `${s.questions} questions, published`
                                    : `${s.questions} questions, not published`,
                        }))}
                    />
                    {hasPerm("instrument.author") && (
                        <button className="tprm-btn" onClick={newDraft} disabled={busy}>
                            New draft version
                        </button>
                    )}
                </div>
            </div>

            {!data && <div className="tprm-loading">Loading...</div>}

            {data && data.versions.length === 0 && (
                <div className="tprm-note warn">
                    No instrument exists for this sector yet. Until a version is published,
                    suppliers in this sector cannot be assessed.
                    {hasPerm("instrument.author") && (
                        <div style={{ marginTop: 12 }}>
                            <button className="tprm-btn primary sm" onClick={newDraft} disabled={busy}>
                                Create the first draft version
                            </button>
                        </div>
                    )}
                </div>
            )}

            {data && data.versions.length > 0 && (
                <>
                    <div className="tprm-grid k4" style={{ marginBottom: 18 }}>
                        {[
                            ["Tiering questions", tiering.length, "var(--tprm-blue)"],
                            ["Control questions", controls.length, "var(--tprm-green)"],
                            ["Standards mapped", data.standards.length, "var(--tprm-gold)"],
                            ["Version", "v" + data.current.version_no, "var(--tprm-ink)"],
                        ].map(([label, value, colour]) => (
                            <div className="tprm-card tprm-kpi" key={label} style={{ borderTopColor: colour }}>
                                <div className="tprm-kpi-value" style={{ color: colour, marginTop: 0 }}>
                                    {value}
                                </div>
                                <div className="tprm-kpi-sub">{label}</div>
                            </div>
                        ))}
                    </div>

                    <div className={"tprm-qb-body" + (refreshing ? " refreshing" : "")}>

                    <div className="tprm-card flush" style={{ marginBottom: 18 }}>
                        <div className="tprm-card-head"><div className="tprm-card-title">VERSIONS</div></div>
                        <table className={"tprm-table" + (mayAuthor ? " tprm-qb-authoring" : "")}>
                            <thead>
                                <tr><th>Version</th><th>Status</th><th>Change note</th><th>Published</th><th></th></tr>
                            </thead>
                            <tbody>
                                {data.versions.map(v => (
                                    <tr
                                        key={v.instrument_version_id}
                                        className={"tprm-qb-vrow"
                                            + (v.instrument_version_id === data.current.instrument_version_id
                                                ? " on" : "")}
                                        onClick={() => {
                                            if (v.instrument_version_id
                                                !== data.current.instrument_version_id) {
                                                setVersionId(v.instrument_version_id);
                                            }
                                        }}
                                        title={`Show the questions in v${v.version_no}`}
                                    >
                                        <td className="num" style={{ fontWeight: 700 }}>v{v.version_no}</td>
                                        <td>
                                            <span className={"tprm-chip " + (
                                                v.status === "published" ? "green"
                                                    : v.status === "draft" ? "amber" : "grey")}>
                                                {v.status}
                                            </span>
                                        </td>
                                        {/* Editable while it is a draft, for the same
                                            reason the questions are: nothing in an
                                            unpublished version is settled yet.

                                            The open editor keeps its own clicks, but only
                                            the editor: guarding the whole cell made the
                                            widest column in the row dead to the click that
                                            selects a version. */}
                                        <td style={{ fontSize: 12, color: "var(--tprm-muted)" }}>
                                            {noteEdit && noteEdit.id === v.instrument_version_id ? (
                                                <div className="tprm-qb-noteedit"
                                                    onClick={e => e.stopPropagation()}>
                                                    <input
                                                        className="tprm-input"
                                                        autoFocus
                                                        value={noteEdit.text}
                                                        onChange={e => setNoteEdit(n => ({ ...n, text: e.target.value }))}
                                                        onKeyDown={e => {
                                                            if (e.key === "Enter") saveNote();
                                                            if (e.key === "Escape") setNoteEdit(null);
                                                        }}
                                                    />
                                                    <button
                                                        className="tprm-btn sm primary"
                                                        onClick={saveNote}
                                                        disabled={busy || noteEdit.text.trim().length < 5}
                                                        title={noteEdit.text.trim().length < 5
                                                            ? "At least 5 characters" : undefined}
                                                    >Save</button>
                                                    <button
                                                        className="tprm-btn sm"
                                                        onClick={() => setNoteEdit(null)}
                                                    >Cancel</button>
                                                </div>
                                            ) : (
                                                <span className="tprm-qb-note">
                                                    {v.change_note || <i>no note</i>}
                                                    {v.status === "draft" && hasPerm("instrument.author") && (
                                                        <button
                                                            className="tprm-iconbtn"
                                                            title="Edit the change note"
                                                            onClick={e => {
                                                                // Opens the editor without also
                                                                // selecting the row, whose reload
                                                                // would close it again.
                                                                e.stopPropagation();
                                                                setNoteEdit({
                                                                    id: v.instrument_version_id,
                                                                    text: v.change_note || "",
                                                                });
                                                            }}
                                                        ><FaPen /></button>
                                                    )}
                                                </span>
                                            )}
                                        </td>
                                        <td className="tprm-nowrap" style={{ fontSize: 12 }}>
                                            {v.published_time ? String(v.published_time).slice(0, 10) : "-"}
                                        </td>
                                        <td>
                                            {v.status === "draft" && (
                                                <div className="tprm-rowacts">
                                                    {hasPerm("instrument.publish") && (
                                                        <button
                                                            className="tprm-btn sm primary"
                                                            onClick={() => publish(v)}
                                                            disabled={busy || !publishable}
                                                            title={publishBlocker || undefined}
                                                        >
                                                            Publish
                                                        </button>
                                                    )}
                                                    {/* The 409 on a second draft says "publish or
                                                        discard it" - this is the discard. */}
                                                    {hasPerm("instrument.author") && (
                                                        <button
                                                            className="tprm-btn sm"
                                                            onClick={discardDraft}
                                                            disabled={busy}
                                                        >
                                                            Discard
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {data.standards.length > 0 && (
                        <div className="tprm-card" style={{ marginBottom: 18 }}>
                            <div className="tprm-card-title" style={{ marginBottom: 10 }}>
                                STANDARDS MAPPED IN v{data.current.version_no}
                            </div>
                            <div className="tprm-qb-standards">
                                {data.standards.map(s => (
                                    <span className="tprm-chip blue" key={s}>{s}</span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Thirty questions typed one at a time is thirty rows of form
                        filling. The workbook is a faster door to the same place -
                        the columns are the ones the row editor has, and nothing
                        lands until the preview has been looked at. */}
                    {mayAuthor && draft && (
                        <div className="tprm-card" style={{ marginBottom: 18 }}>
                            <div className="tprm-card-title" style={{ marginBottom: 10 }}>
                                Write the questions in Excel
                            </div>
                            <div className="tprm-qb-bulk">
                                <button
                                    className={"tprm-btn" + (bulkBusy === "dl" ? " loading" : "")}
                                    disabled={!!bulkBusy}
                                    onClick={downloadTemplate}
                                >
                                    {bulkBusy === "dl" ? "Building..." : "Download question template"}
                                </button>
                                <input
                                    ref={bulkRef}
                                    type="file"
                                    accept=".xlsx,.xls"
                                    style={{ display: "none" }}
                                    onChange={e => {
                                        const f = e.target.files[0];
                                        e.target.value = "";
                                        if (f) previewImport(f);
                                    }}
                                />
                                <button
                                    className={"tprm-btn primary" + (bulkBusy === "up" ? " loading" : "")}
                                    disabled={!!bulkBusy}
                                    onClick={() => bulkRef.current && bulkRef.current.click()}
                                >
                                    {bulkBusy === "up" ? "Reading..." : "Import a filled template"}
                                </button>
                                <div className="tprm-hint" style={{ margin: 0 }}>
                                    Two sheets, Tiering and Control, with a Reference sheet listing
                                    every code they accept. Nothing is written until you confirm.
                                </div>
                            </div>
                        </div>
                    )}

                    {preview && (
                        <div className="tprm-modal-backdrop">
                            <div className="tprm-modal wide">
                                <div className="tprm-modal-head">
                                    <div>
                                        <div className="tprm-modal-title">Import questions</div>
                                        <div className="tprm-modal-sub">
                                            {preview.summary.willImport} of {preview.summary.read} rows
                                            will be added to v{draft ? draft.version_no : ""}. Nothing
                                            is written until you confirm.
                                        </div>
                                    </div>
                                    <button
                                        className="tprm-modal-close"
                                        aria-label="Close"
                                        onClick={() => setPreview(null)}
                                        disabled={!!bulkBusy}
                                    >
                                        &times;
                                    </button>
                                </div>
                                <div className="tprm-modal-body">
                                    <div className="tprm-grid k4" style={{ marginBottom: 16 }}>
                                        {[
                                            ["Rows read", preview.summary.read, "var(--tprm-navy)"],
                                            ["Will import", preview.summary.willImport, "var(--tprm-green)"],
                                            ["Rejected", preview.summary.rejected, "var(--tprm-red)"],
                                            ["Tiering / control",
                                                `${preview.summary.tiering} / ${preview.summary.control}`,
                                                "var(--tprm-blue)"],
                                        ].map(x => (
                                            <div className="tprm-card tprm-kpi" key={x[0]}
                                                style={{ borderTopColor: x[2] }}>
                                                <div className="tprm-kpi-value" style={{ color: x[2] }}>
                                                    {x[1]}
                                                </div>
                                                <div className="tprm-kpi-sub">{x[0]}</div>
                                            </div>
                                        ))}
                                    </div>

                                    {preview.problems.length > 0 && (
                                        <div className="tprm-note danger" style={{ marginBottom: 16 }}>
                                            <b>{preview.problems.length} rows will be skipped.</b>
                                            <ul style={{ margin: "8px 0 0 18px" }}>
                                                {preview.problems.slice(0, 8).map((p, i) => (
                                                    <li key={i}>
                                                        {p.sheet} row {p.rowNo}
                                                        {p.qRef ? ` (${p.qRef})` : ""} — {p.errors.join("; ")}
                                                    </li>
                                                ))}
                                                {preview.problems.length > 8 && (
                                                    <li>and {preview.problems.length - 8} more</li>
                                                )}
                                            </ul>
                                        </div>
                                    )}

                                    <div className="tprm-card flush" style={{ overflowX: "auto" }}>
                                        <table className="tprm-table">
                                            <thead>
                                                <tr>
                                                    <th>Ref</th><th>Type</th><th>Area</th>
                                                    <th>Question</th><th>Tier</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {preview.rows.map(r => (
                                                    <tr key={r.sheet + r.rowNo}>
                                                        <td className="mono">{r.qRef}</td>
                                                        <td>
                                                            <span className={"tprm-chip "
                                                                + (r.qType === "tiering" ? "blue" : "green")}>
                                                                {r.qType}
                                                            </span>
                                                        </td>
                                                        <td className="mono">
                                                            {r.dimensionCode || r.domainCode}
                                                        </td>
                                                        <td>{r.qText}</td>
                                                        <td className="mono">{r.tierApplies}</td>
                                                    </tr>
                                                ))}
                                                {preview.rows.length === 0 && (
                                                    <tr><td colSpan={5} className="tprm-empty">
                                                        Nothing here can be imported. Fix the rows above
                                                        and upload the workbook again.
                                                    </td></tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                                <div className="tprm-modal-foot">
                                    <button className="tprm-btn" onClick={() => setPreview(null)}
                                        disabled={!!bulkBusy}>
                                        Cancel
                                    </button>
                                    <button
                                        className={"tprm-btn gold" + (bulkBusy === "commit" ? " loading" : "")}
                                        onClick={commitImport}
                                        disabled={!!bulkBusy || !preview.summary.willImport}
                                    >
                                        {bulkBusy === "commit"
                                            ? "Importing..."
                                            : `Import ${preview.summary.willImport} questions`}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="tprm-card flush" style={{ marginBottom: 18, overflowX: "auto" }}>
                        <div className="tprm-card-head">
                            <div className="tprm-card-title">
                                TIERING QUESTIONS ({tiering.length}) in v{data.current.version_no}
                                {" "}— answered by the client
                            </div>
                            {mayAuthor && (
                                <button
                                    className="tprm-btn sm gold"
                                    style={{ marginLeft: "auto" }}
                                    onClick={() => startAdd("tiering")}
                                >
                                    <FaPlus style={{ marginRight: 6 }} />Add tiering question
                                </button>
                            )}
                        </div>
                        <table className={"tprm-table" + (mayAuthor ? " tprm-qb-authoring" : "")}>
                            <thead>
                                <tr>
                                    <th>Ref</th><th>Dimension</th><th>Question</th>
                                    <th>1</th><th>2</th><th>3</th>
                                    {mayAuthor && <th>Edit</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {tiering.map(q => (rowOf("tiering") && rowOf("tiering").key === q.question_id ? (
                                    <QuestionEditRow
                                        key={q.question_id}
                                        qType="tiering"
                                        form={rowOf("tiering").form}
                                        setForm={fn => setRowForm("tiering", fn)}
                                        dimensions={dimensions} domains={domains}
                                        onSave={() => saveRow("tiering")} onCancel={() => putRow("tiering", null)}
                                        busy={busy} isNew={false}
                                    />
                                ) : (
                                    <tr key={q.question_id}>
                                        <td className="num" style={{ fontWeight: 700 }}>{q.q_ref}</td>
                                        <td style={{ fontSize: 12 }}>{q.dimension_name || q.dimension_code}</td>
                                        <td style={{ fontSize: 12.5, maxWidth: 340 }}>{q.q_text}</td>
                                        <td className="tprm-qb-scale">{q.score_1_label}</td>
                                        <td className="tprm-qb-scale">{q.score_2_label}</td>
                                        <td className="tprm-qb-scale">{q.score_3_label}</td>
                                        {mayAuthor && rowActions(q, tiering)}
                                    </tr>
                                )))}
                                {/* The blank row sits at the end of the list it is
                                    joining, so what you are writing is read in the
                                    company of what you already wrote. */}
                                {rowOf("tiering") && rowOf("tiering").key === "new" && (
                                    <QuestionEditRow
                                        qType="tiering"
                                        form={rowOf("tiering").form}
                                        setForm={fn => setRowForm("tiering", fn)}
                                        dimensions={dimensions} domains={domains}
                                        onSave={() => saveRow("tiering")} onCancel={() => putRow("tiering", null)}
                                        busy={busy} isNew
                                    />
                                )}
                                {tiering.length === 0 && !rowOf("tiering") && (
                                    <tr><td colSpan={mayAuthor ? 7 : 6} className="tprm-empty">
                                        No tiering questions yet.
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <div className="tprm-card flush" style={{ overflowX: "auto" }}>
                        <div className="tprm-card-head">
                            <div className="tprm-card-title">
                                CONTROL QUESTIONS ({controls.length}) in v{data.current.version_no}
                                {" "}— answered by the supplier
                            </div>
                            {mayAuthor && (
                                <button
                                    className="tprm-btn sm gold"
                                    style={{ marginLeft: "auto" }}
                                    onClick={() => startAdd("control")}
                                >
                                    <FaPlus style={{ marginRight: 6 }} />Add control question
                                </button>
                            )}
                        </div>
                        <table className={"tprm-table" + (mayAuthor ? " tprm-qb-authoring" : "")}>
                            <thead>
                                <tr>
                                    <th>Ref</th><th>Control area</th><th>Question</th>
                                    <th>Evidence expected</th><th>Standard</th><th>Applies to</th>
                                    {mayAuthor && <th>Edit</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {controls.map(q => (rowOf("control") && rowOf("control").key === q.question_id ? (
                                    <QuestionEditRow
                                        key={q.question_id}
                                        qType="control"
                                        form={rowOf("control").form}
                                        setForm={fn => setRowForm("control", fn)}
                                        dimensions={dimensions} domains={domains}
                                        onSave={() => saveRow("control")} onCancel={() => putRow("control", null)}
                                        busy={busy} isNew={false}
                                    />
                                ) : (
                                    <tr key={q.question_id}>
                                        <td className="num" style={{ fontWeight: 700 }}>{q.q_ref}</td>
                                        <td style={{ fontSize: 12 }}>{q.domain_name || q.domain_code}</td>
                                        <td style={{ fontSize: 12.5, maxWidth: 320 }}>{q.q_text}</td>
                                        <td style={{ fontSize: 11.5, color: "var(--tprm-muted)", maxWidth: 220 }}>
                                            {q.evidence_required}
                                        </td>
                                        <td style={{ fontSize: 11, color: "var(--tprm-faint)" }}>
                                            {q.standards_mapping}
                                        </td>
                                        <td>
                                            <span className="tprm-chip grey">
                                                {Number(q.tier_applies) === 1 ? "Tier 1"
                                                    : Number(q.tier_applies) === 2 ? "Tier 1-2" : "All tiers"}
                                            </span>
                                        </td>
                                        {mayAuthor && rowActions(q, controls)}
                                    </tr>
                                )))}
                                {rowOf("control") && rowOf("control").key === "new" && (
                                    <QuestionEditRow
                                        qType="control"
                                        form={rowOf("control").form}
                                        setForm={fn => setRowForm("control", fn)}
                                        dimensions={dimensions} domains={domains}
                                        onSave={() => saveRow("control")} onCancel={() => putRow("control", null)}
                                        busy={busy} isNew
                                    />
                                )}
                                {controls.length === 0 && !rowOf("control") && (
                                    <tr><td colSpan={mayAuthor ? 7 : 6} className="tprm-empty">
                                        No control questions yet.
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    </div>
                </>
            )}


            <TPRMInstrumentManager
                open={managing}
                onClose={() => setManaging(false)}
                onChanged={() => { loadSectors(); load(); }}
            />
        </div>
    );
}

export default TPRMQuestionBank;
