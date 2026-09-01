import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import LeftNavbar from "./left_navbar";
import TopBar from "./TPRM_TopBar";
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
import Banners from "./TPRM_Banners";
import MyAccount from "./TPRM_MyAccount";

import "./App.css";

function App() {
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
                    <LeftNavbar />
                    <div className="tprm-main">
                        <TopBar />
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
                            <Route path="/Banners" element={
                                <ProtectedRoute perm="banner.manage"><Banners /></ProtectedRoute>} />
                            {/* No permission: everyone may see their own account. */}
                            <Route path="/My_Account" element={
                                <ProtectedRoute><MyAccount /></ProtectedRoute>} />
                            <Route path="*" element={<Navigate to="/Dashboard" replace />} />
                        </Routes>
                    </div>
                </div>
            )}
        </AccessProvider>
    );
}

export default App;
