#!/usr/bin/env python3
import csv
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.enums import TA_LEFT

styles=getSampleStyleSheet()
cell=ParagraphStyle('cell',parent=styles['Normal'],fontSize=7,leading=8.5)
cellb=ParagraphStyle('cellb',parent=cell,fontName='Helvetica-Bold')
hdr=ParagraphStyle('hdr',parent=styles['Normal'],fontSize=7.5,leading=9,textColor=colors.white,fontName='Helvetica-Bold')
title=ParagraphStyle('title',parent=styles['Title'],fontSize=15)
sub=ParagraphStyle('sub',parent=styles['Normal'],fontSize=8,textColor=colors.grey)
sec=ParagraphStyle('sec',parent=styles['Heading2'],fontSize=11,spaceBefore=8)

FIT_BG={'5':colors.HexColor('#C6EFCE'),'4':colors.HexColor('#D9EAD3'),'3':colors.HexColor('#FFF2CC'),
        '2':colors.HexColor('#FCE5CD'),'1':colors.HexColor('#F4CCCC')}
COLS=['fit_score','fund(s)','company','ownership','role_title','seniority','years_req','remote_scope','posted_date','comp_range','domain_note','ats_link']
HDR=['Fit','Fund(s)','Company','Own','Role','Sr','Yrs','Location','Posted','Comp','Domain','Apply']
# col widths (mm) tuned for A3 landscape (~400mm usable)
W=[9,34,30,16,66,20,12,40,20,30,52,16]

def esc(s): return (s or '').replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

def build_table(csv_path):
    rows=list(csv.DictReader(open(csv_path)))
    data=[[Paragraph(h,hdr) for h in HDR]]
    stylecmds=[('BACKGROUND',(0,0),(-1,0),colors.HexColor('#1F3864')),
               ('GRID',(0,0),(-1,-1),0.4,colors.HexColor('#D9D9D9')),
               ('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),2),
               ('BOTTOMPADDING',(0,0),(-1,-1),2),('LEFTPADDING',(0,0),(-1,-1),3),('RIGHTPADDING',(0,0),(-1,-1),3)]
    for i,r in enumerate(rows,1):
        link=r['ats_link']
        applyp=Paragraph(f'<link href="{esc(link)}"><font color="#0563C1">apply ↗</font></link>',cell) if link else Paragraph('',cell)
        line=[Paragraph(f'<b>{esc(r["fit_score"])}</b>',cellb),
              Paragraph(esc(r['fund(s)']),cell),
              Paragraph(esc(r['company']),cellb),
              Paragraph(esc(r['ownership']),cell),
              Paragraph(esc(r['role_title']),cell),
              Paragraph(esc(r['seniority']),cell),
              Paragraph(esc(r['years_req']),cell),
              Paragraph(esc(r['remote_scope']),cell),
              Paragraph(esc(r['posted_date']),cell),
              Paragraph(esc(r['comp_range']),cell),
              Paragraph(esc(r['domain_note']),cell),
              applyp]
        data.append(line)
        bg=FIT_BG.get(r['fit_score'])
        if bg: stylecmds.append(('BACKGROUND',(0,i),(0,i),bg))
        if i%2==0: stylecmds.append(('BACKGROUND',(1,i),(-1,i),colors.HexColor('#F7F7F7')))
    t=Table(data,colWidths=[w*mm for w in W],repeatRows=1)
    t.setStyle(TableStyle(stylecmds))
    return t,len(rows)

doc=SimpleDocTemplate('fp_a_remote_roles.pdf',pagesize=landscape(A3),
                      leftMargin=8*mm,rightMargin=8*mm,topMargin=8*mm,bottomMargin=8*mm)
el=[]
el.append(Paragraph('FP&amp;A / Strategic Finance / Financial-Analyst Roles — VC Portfolio Sweep',title))
el.append(Paragraph('Remote-US or Dallas–Fort Worth metro (in-office/hybrid OK) • 8 yrs of experience qualifies (stated min ≤8) • posted ≤60 days • public + private • Fit: 5=payer core, 4=health-tech, 3=fintech/insurtech, 2=other SaaS, 1=no overlap',sub))
el.append(Spacer(1,4*mm))
t,n=build_table('fp_a_remote_roles.csv')
el.append(Paragraph(f'Matches ({n})',sec)); el.append(t)
try:
    t2,n2=build_table('fp_a_verify.csv')
    el.append(Spacer(1,5*mm))
    el.append(Paragraph(f'Remote-eligibility unconfirmed — verify before applying ({n2})',sec))
    el.append(Paragraph('ATS flags these remote-eligible but the posting lists an office HQ and the JD does not confirm remote.',sub))
    el.append(t2)
except FileNotFoundError: pass
doc.build(el)
print('wrote fp_a_remote_roles.pdf')
