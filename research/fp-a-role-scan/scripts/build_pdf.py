#!/usr/bin/env python3
# Header-driven landscape PDF. argv: main_csv verify_csv out_pdf "Title" "Subtitle"
import csv,sys
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer

styles=getSampleStyleSheet()
cell=ParagraphStyle('cell',parent=styles['Normal'],fontSize=7,leading=8.5)
cellb=ParagraphStyle('cellb',parent=cell,fontName='Helvetica-Bold')
hdrst=ParagraphStyle('hdr',parent=styles['Normal'],fontSize=7.5,leading=9,textColor=colors.white,fontName='Helvetica-Bold')
title=ParagraphStyle('title',parent=styles['Title'],fontSize=15)
sub=ParagraphStyle('sub',parent=styles['Normal'],fontSize=8,textColor=colors.grey)
sec=ParagraphStyle('sec',parent=styles['Heading2'],fontSize=11,spaceBefore=8)

FIT_BG={'5':colors.HexColor('#C6EFCE'),'4':colors.HexColor('#D9EAD3'),'3':colors.HexColor('#FFF2CC'),'2':colors.HexColor('#FCE5CD'),'1':colors.HexColor('#F4CCCC')}
LABELS={'fit_score':'Fit','fund(s)':'Fund(s)','company':'Company','ownership':'Own','role_title':'Role',
        'seniority':'Sr','years_req':'Yrs','remote_scope':'Location','posted_date':'Posted','comp_range':'Comp',
        'domain_note':'Domain','ats_link':'Apply'}
WIDTHS={'fit_score':9,'fund(s)':32,'company':30,'ownership':16,'role_title':60,'seniority':16,'years_req':11,
        'remote_scope':42,'posted_date':18,'comp_range':30,'domain_note':46,'ats_link':16}
BOLD={'company','comp_range'}
def esc(s): return (s or '').replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

def build_table(csv_path):
    rows=list(csv.DictReader(open(csv_path)))
    if not rows: return None,0
    cols=list(rows[0].keys())
    data=[[Paragraph(LABELS.get(c,c.replace('_',' ').title()),hdrst) for c in cols]]
    style=[('BACKGROUND',(0,0),(-1,0),colors.HexColor('#1F3864')),('GRID',(0,0),(-1,-1),0.4,colors.HexColor('#D9D9D9')),
           ('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),2),('BOTTOMPADDING',(0,0),(-1,-1),2),
           ('LEFTPADDING',(0,0),(-1,-1),3),('RIGHTPADDING',(0,0),(-1,-1),3)]
    fit_idx=cols.index('fit_score') if 'fit_score' in cols else -1
    for i,r in enumerate(rows,1):
        line=[]
        for c in cols:
            v=r.get(c,'')
            if c=='ats_link':
                line.append(Paragraph(f'<link href="{esc(v)}"><font color="#0563C1">apply ↗</font></link>',cell) if v else Paragraph('',cell))
            elif c in BOLD:
                line.append(Paragraph(esc(v),cellb))
            else:
                line.append(Paragraph(esc(v),cell))
        data.append(line)
        if fit_idx>=0 and FIT_BG.get(r.get('fit_score')):
            style.append(('BACKGROUND',(fit_idx,i),(fit_idx,i),FIT_BG[r['fit_score']]))
        if i%2==0: style.append(('BACKGROUND',(0,i),(-1,i),colors.HexColor('#F7F7F7')))
    widths=[WIDTHS.get(c,20)*mm for c in cols]
    t=Table(data,colWidths=widths,repeatRows=1); t.setStyle(TableStyle(style))
    return t,len(rows)

MAIN=sys.argv[1] if len(sys.argv)>1 else 'fp_a_remote_roles.csv'
VER=sys.argv[2] if len(sys.argv)>2 else 'fp_a_verify.csv'
OUT=sys.argv[3] if len(sys.argv)>3 else 'out.pdf'
TITLE=sys.argv[4] if len(sys.argv)>4 else 'Roles'
SUBT=sys.argv[5] if len(sys.argv)>5 else ''
doc=SimpleDocTemplate(OUT,pagesize=landscape(A3),leftMargin=8*mm,rightMargin=8*mm,topMargin=8*mm,bottomMargin=8*mm)
el=[Paragraph(TITLE,title),Paragraph(SUBT,sub),Spacer(1,4*mm)]
t,n=build_table(MAIN)
el.append(Paragraph(f'Matches ({n})',sec)); el.append(t)
import os
if os.path.exists(VER):
    t2,n2=build_table(VER)
    if t2 is not None and n2:
        el.append(Spacer(1,5*mm)); el.append(Paragraph(f'Remote-eligibility unconfirmed — verify ({n2})',sec)); el.append(t2)
doc.build(el)
print('wrote',OUT)
