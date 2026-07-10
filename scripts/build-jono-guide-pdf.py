# Builds the combined LUXWELD setup guide for Jono as a clean, printable PDF.
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image,
    ListFlowable, ListItem, HRFlowable, KeepTogether,
)
import os

OUT = r"C:\Users\Flynn\New folder\LUXWELD-Setup-Guide-for-Jono.pdf"
MARK = r"C:\Users\Flynn\New folder\public\brand\mark.png"

INK = colors.HexColor("#1d1d22")
MUTE = colors.HexColor("#5b5b63")
GOLD = colors.HexColor("#A9842B")
GOLD_LT = colors.HexColor("#f6edd6")
GREEN = colors.HexColor("#1f7a4d")
GREEN_LT = colors.HexColor("#e9f7ef")
AMBER = colors.HexColor("#8a6d1a")
AMBER_LT = colors.HexColor("#fbf3da")
CODE_BG = colors.HexColor("#f2f2f4")
LINE = colors.HexColor("#dedee3")

ss = getSampleStyleSheet()
body = ParagraphStyle("body", parent=ss["Normal"], fontName="Helvetica",
                      fontSize=10.5, leading=15, textColor=INK, spaceAfter=6)
lead = ParagraphStyle("lead", parent=body, fontSize=11, leading=16)
h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontName="Helvetica-Bold",
                    fontSize=14, leading=18, textColor=GOLD, spaceBefore=6, spaceAfter=4)
h2sub = ParagraphStyle("h2sub", parent=body, fontSize=9.5, textColor=MUTE, spaceAfter=8)
parth = ParagraphStyle("parth", parent=body, fontName="Helvetica-Bold",
                       fontSize=11, textColor=INK, spaceBefore=6, spaceAfter=3)
li = ParagraphStyle("li", parent=body, spaceAfter=3)
code = ParagraphStyle("code", parent=body, fontName="Courier", fontSize=10,
                      textColor=colors.HexColor("#8a2b2b"), leading=13)
title = ParagraphStyle("title", parent=ss["Title"], fontName="Helvetica-Bold",
                       fontSize=22, textColor=INK, spaceAfter=2, alignment=TA_LEFT)
subtitle = ParagraphStyle("subtitle", parent=body, fontSize=11, textColor=MUTE, spaceAfter=0)

story = []

def callout(text, bg, fg, label=None):
    inner = []
    if label:
        inner.append(Paragraph(f'<b>{label}</b>', ParagraphStyle(
            "cl", parent=body, textColor=fg, spaceAfter=2, fontName="Helvetica-Bold")))
    inner.append(Paragraph(text, ParagraphStyle("cb", parent=body, textColor=fg, spaceAfter=0)))
    t = Table([[inner]], colWidths=[165*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEBEFORE", (0, 0), (0, -1), 3, fg),
        ("ROUNDEDCORNERS", [4, 4, 4, 4]),
    ]))
    return t

def codebox(text):
    t = Table([[Paragraph(text, code)]], colWidths=[165*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CODE_BG),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return t

def numbered(items):
    return ListFlowable(
        [ListItem(Paragraph(x, li), leftIndent=6, value=i+1) for i, x in enumerate(items)],
        bulletType="1", bulletFormat="%s.", leftIndent=18, bulletFontName="Helvetica-Bold",
        bulletColor=GOLD,
    )

def rule():
    return HRFlowable(width="100%", thickness=0.7, color=LINE, spaceBefore=10, spaceAfter=10)

# ---- Header ----
head_cells = []
if os.path.exists(MARK):
    img = Image(MARK, width=16*mm, height=16*mm)
    head_cells = [[img, [Paragraph("LUXWELD", title), Paragraph("Warranty backup &mdash; setup guide", subtitle)]]]
    ht = Table(head_cells, colWidths=[20*mm, 145*mm])
    ht.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(ht)
else:
    story.append(Paragraph("LUXWELD", title))
    story.append(Paragraph("Warranty backup &mdash; setup guide", subtitle))

story.append(HRFlowable(width="100%", thickness=2, color=GOLD, spaceBefore=8, spaceAfter=10))

story.append(Paragraph(
    "This is your one-time setup for the LUXWELD warranty backups. When it's done, "
    "every warranty record (all photos + details) is copied automatically to your Google "
    "Drive and to a physical hard drive &mdash; with nothing to remember day to day. "
    "Work through it top to bottom.", lead))

story.append(callout(
    "You can start <b>Step 1 today, from your own computer</b> (a laptop/desktop is much "
    "easier than a phone for this one). Step 2 needs Flynn to plug in your two codes first, "
    "so the order is: <b>you do Step 1 &rarr; send Flynn the two codes &rarr; Flynn confirms "
    "&rarr; you do Step 2.</b>",
    GOLD_LT, GOLD, label="Can I do this now?"))
story.append(Spacer(1, 4))
story.append(callout(
    "If any screen looks different from this guide (Google changes their layout sometimes), "
    "don't guess &mdash; take a screenshot and send it to Flynn. Nothing here can break the website.",
    AMBER_LT, AMBER, label="If you get stuck"))

story.append(rule())

# ---- STEP 1 ----
story.append(Paragraph("Step 1 &mdash; Create the Google connection", h2))
story.append(Paragraph("About 15 minutes, one time. This is the only technical part &mdash; it "
                       "creates the secure link that lets the website save into your Google Drive.", h2sub))

story.append(Paragraph("Part A &mdash; Create a project", parth))
story.append(numbered([
    "Go to <b>console.cloud.google.com</b> and sign in with the LUXWELD Google account.",
    "If it asks about terms of service, tick agree and continue.",
    "At the very top, click the <b>project dropdown</b> (may say &ldquo;Select a project&rdquo;) &rarr; "
    "<b>New Project</b> (top right).",
    "<b>Name:</b> type <b>LUXWELD Warranty</b>. Leave the rest as-is. Click <b>Create</b>.",
    "Wait a few seconds, then make sure the top dropdown shows <b>LUXWELD Warranty</b> (select it if not).",
]))

story.append(Paragraph("Part B &mdash; Turn on Google Drive", parth))
story.append(numbered([
    "In the search bar at the top, type <b>Google Drive API</b> and press Enter.",
    "Click the result <b>Google Drive API</b>.",
    "Click the blue <b>Enable</b> button and wait for it to finish.",
]))

story.append(KeepTogether([
    Paragraph("Part C &mdash; Set up and PUBLISH the consent screen", parth),
    Paragraph("<i>This is the part people miss &mdash; do all 5 steps, especially step 5.</i>", h2sub),
    numbered([
        "In the top search bar, type <b>OAuth consent screen</b> and open it. "
        "(On newer layouts it's under <b>Google Auth Platform</b> &rarr; <b>Branding</b> / <b>Audience</b>.)",
        "If asked <b>User Type</b>, choose <b>External</b>, then <b>Create</b>.",
        "Fill only the required fields (red star): <b>App name</b> = <b>LUXWELD Warranty</b>; "
        "<b>User support email</b> = pick your email; <b>Developer contact</b> = your email again. "
        "Click <b>Save and Continue</b> through the next pages (nothing to add).",
        "Find the <b>Audience</b> (or <b>Publishing status</b>) page.",
        "Under <b>Publishing status</b> it likely says <b>Testing</b>. Click <b>Publish app</b> &rarr; "
        "<b>Confirm</b>. It should now say <b>In production</b>. &larr; the important one.",
    ]),
    callout("If you skip &ldquo;Publish&rdquo;, the backup will quietly stop working after 7 days.",
            AMBER_LT, AMBER, label="Don't skip step 5"),
]))

story.append(Paragraph("Part D &mdash; Create the connection (OAuth client)", parth))
story.append(numbered([
    "In the top search bar, type <b>Credentials</b> and open it (<b>APIs &amp; Services &rarr; Credentials</b>).",
    "Click <b>+ Create Credentials</b> &rarr; <b>OAuth client ID</b>.",
    "<b>Application type:</b> choose <b>Web application</b>.",
    "<b>Name:</b> <b>LUXWELD Warranty website</b> (any name is fine).",
    "Scroll to <b>Authorised redirect URIs</b> &rarr; click <b>+ Add URI</b> and paste this exactly:",
]))
story.append(codebox("https://warranty.luxweld.com.au/admin/drive/callback"))
story.append(Paragraph("Then click <b>+ Add URI</b> once more and paste this second one too "
                       "(for future Google login):", li))
story.append(codebox("https://warranty.luxweld.com.au/auth/google/callback"))
story.append(Paragraph("Then click <b>Create</b>.", li))

story.append(Paragraph("Part E &mdash; Copy the two codes and send them to Flynn", parth))
story.append(Paragraph("A window titled <b>&ldquo;OAuth client created&rdquo;</b> appears with:", li))
story.append(numbered([
    "<b>Client ID</b> &mdash; a long code ending in <font face='Courier'>.apps.googleusercontent.com</font>",
    "<b>Client secret</b> &mdash; a shorter code starting with something like <font face='Courier'>GOCSPX-</font>",
]))
story.append(Paragraph("Copy <b>both</b> (there are copy buttons) and <b>send them to Flynn</b> like you "
                       "would a password &mdash; don't post them publicly. If the window closed, reopen it from "
                       "<b>Credentials</b> &rarr; click your client name &rarr; the codes are on the right.", li))
story.append(callout("Flynn confirms your two codes are in, and the <b>Google Drive</b> box on the Archive "
                     "page changes from &ldquo;Not set up&rdquo; to a <b>Connect Google Drive</b> button.",
                     GREEN_LT, GREEN, label="You know Step 1 is done when"))

story.append(rule())

# ---- STEP 2 ----
story.append(Paragraph("Step 2 &mdash; Turn on the automatic backup", h2))
story.append(Paragraph("About 2 minutes. Do this after Flynn confirms Step 1.", h2sub))
story.append(numbered([
    "Go to <b>warranty.luxweld.com.au</b> and log in (email <b>jono@luxweld.com.au</b>; if unsure of the "
    "password, ask Flynn to reset it).",
    "Click <b>Archive</b> in the top menu.",
    "Find the <b>Google Drive backup</b> box near the top and click <b>Connect Google Drive</b>.",
    "Sign in with <b>your</b> Google account and click <b>Allow / Continue</b>.",
    "You'll return to the Archive page and it will say the first backup is uploading.",
]))
story.append(callout("Open Google Drive (drive.google.com) &mdash; within a few minutes a folder called "
                     "<b>&ldquo;LUXWELD Warranty Archive&rdquo;</b> fills up, one folder per flashing.",
                     GREEN_LT, GREEN, label="You know it worked when"))
story.append(Paragraph("<b>Finding a record later:</b> in Google Drive, just type into the search bar "
                       "&mdash; a serial number, an installer's name, a site, or a date &mdash; and the matching "
                       "folder appears with all its photos and details inside.", body))

story.append(rule())

# ---- STEP 3 ----
story.append(Paragraph("Step 3 &mdash; Keep the website switched on (with Flynn)", h2))
story.append(Paragraph("The site currently runs on a free trial that can switch it off. Upgrading keeps it "
                       "on 24/7. Flynn will sit with you &mdash; it's a 2-minute payment step and needs your card / "
                       "your call on the plan, so it's the one thing that can't be done ahead of time.", body))
story.append(callout("The plan no longer says &ldquo;Trial&rdquo;, and the &ldquo;shut down&rdquo; emails stop.",
                     GREEN_LT, GREEN, label="You know it worked when"))

story.append(rule())

# ---- STEP 4 ----
story.append(Paragraph("Step 4 &mdash; Set up the always-on backup computer + hard drive", h2))
story.append(Paragraph("About 10 minutes. This is your physical copy: a computer left on that mirrors "
                       "everything from your Google Drive down onto the big external drive.", h2sub))
story.append(Paragraph("On the computer you'll leave running (with the 10&nbsp;TB drive plugged in):", body))
story.append(numbered([
    "Plug in the external hard drive.",
    "Go to <b>google.com/drive/download</b> and install <b>Google Drive for desktop</b>.",
    "Open it and <b>sign in with the same Google account</b> your backups go to.",
    "Click the <b>gear (Settings) &rarr; Preferences &rarr; Google Drive</b>, and choose <b>Mirror files</b> "
    "(keeps a real full copy on the drive, not just links).",
    "When asked where to keep the files (or under <b>Advanced settings</b>), pick the <b>external hard "
    "drive</b> (e.g. <font face='Courier'>E:\\LUXWELD Backup</font>). This same menu is where you'd change the "
    "destination later.",
    "Let it finish the first copy, then open the drive and check the <b>LUXWELD Warranty Archive</b> folder "
    "is really there with photos inside.",
]))
story.append(callout("Keep this computer switched on (turn off &ldquo;sleep&rdquo; in the power settings). "
                     "If it's ever off for a while it's fine &mdash; it catches up as soon as it's back on.",
                     AMBER_LT, AMBER, label="Important"))

story.append(rule())

# ---- STEP 5 ----
story.append(Paragraph("Step 5 (optional) &mdash; A stronger password", h2))
story.append(Paragraph("Your admin login opens everything, so a longer password is much safer than a short "
                       "number. To change it: log in &rarr; <b>Users</b> (top menu) &rarr; on your own account, set a "
                       "new password (a short phrase plus a number and symbol is ideal).", body))

story.append(rule())

story.append(Paragraph("That's it", ParagraphStyle("done", parent=h2, textColor=INK)))
story.append(Paragraph("Once Steps 1, 2 and 4 are done, your warranty data lives in <b>three</b> places at "
                       "once &mdash; the live website, your Google Drive, and your physical hard drive &mdash; all kept "
                       "up to date automatically.", body))


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.7)
    canvas.line(20*mm, 14*mm, 190*mm, 14*mm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTE)
    canvas.drawString(20*mm, 9*mm, "LUXWELD Warranty — backup setup guide")
    canvas.drawRightString(190*mm, 9*mm, "Page %d" % doc.page)
    canvas.restoreState()


doc = SimpleDocTemplate(OUT, pagesize=A4,
                        leftMargin=22*mm, rightMargin=22*mm, topMargin=18*mm, bottomMargin=20*mm,
                        title="LUXWELD Warranty - Setup Guide for Jono", author="LUXWELD")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print("WROTE", OUT, os.path.getsize(OUT), "bytes")
