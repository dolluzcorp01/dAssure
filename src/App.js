import React, { useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import LeftNavbar from "./left_navbar";
import { AccessProvider, ProtectedRoute } from "./utils/AccessContext";

import Login from "./TPRM_Login";
import Dashboard from "./TPRM_Dashboard";
import Clients from "./TPRM_Clients";
import VendorPopulation from "./TPRM_VendorPopulation";
import Assessments from "./TPRM_Assessments";
import AssessmentDetail from "./TPRM_AssessmentDetail";
import Findings from "./TPRM_Findings";
import Reports from "./TPRM_Reports";
import QuestionBank from "./TPRM_QuestionBank";
import Methodology from "./TPRM_Methodology";
import UsersAndRoles from "./TPRM_UsersAndRoles";
import AuditTrail from "./TPRM_AuditTrail";

import "./App.css";

function App() {
    const [navSize, setNavSize] = useState("full");
    const location = useLocation();

    const path = location.pathname.toLowerCase();
    const hideNavbar = path === "/login" || path === "/";

    React.useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

    return (
        <AccessProvider>
            {hideNavbar ? (
                <Routes>
                    <Route path="/" element={<Navigate to="/login" replace />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="*" element={<Navigate to="/login" replace />} />
                </Routes>
            ) : (
                <div className="tprm-layout">
                    <LeftNavbar navSize={navSize} setNavSize={setNavSize} />
                    <div className={`tprm-main ${navSize}`}>
                        <Routes>
                            <Route path="/Dashboard" element={
                                <ProtectedRoute><Dashboard /></ProtectedRoute>} />
                            <Route path="/Clients" element={
                                <ProtectedRoute><Clients /></ProtectedRoute>} />
                            <Route path="/Vendor_Population" element={
                                <ProtectedRoute perm="vendor.manage"><VendorPopulation /></ProtectedRoute>} />
                            <Route path="/Assessments" element={
                                <ProtectedRoute><Assessments /></ProtectedRoute>} />
                            <Route path="/Assessments/:id" element={
                                <ProtectedRoute><AssessmentDetail /></ProtectedRoute>} />
                            <Route path="/Findings" element={
                                <ProtectedRoute><Findings /></ProtectedRoute>} />
                            <Route path="/Reports" element={
                                <ProtectedRoute perm="report.generate"><Reports /></ProtectedRoute>} />
                            <Route path="/Question_Bank" element={
                                <ProtectedRoute><QuestionBank /></ProtectedRoute>} />
                            <Route path="/Methodology" element={
                                <ProtectedRoute perm="methodology.edit"><Methodology /></ProtectedRoute>} />
                            <Route path="/Users_And_Roles" element={
                                <ProtectedRoute perm="user.grant"><UsersAndRoles /></ProtectedRoute>} />
                            <Route path="/Audit_Trail" element={
                                <ProtectedRoute perm="audit.read"><AuditTrail /></ProtectedRoute>} />
                            <Route path="*" element={<Navigate to="/Dashboard" replace />} />
                        </Routes>
                    </div>
                </div>
            )}
        </AccessProvider>
    );
}

export default App;
