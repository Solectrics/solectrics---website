from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
for season,days,kwh,total,period in [('summer',31,430,197.86,'2026-01-01 to 2026-01-31'),('winter',30,1040,413.89,'2026-07-01 to 2026-07-30')]:
 p=Path(__file__).parent/(season+'.pdf');c=canvas.Canvas(str(p),pagesize=A4,invariant=1)
 c.setTitle('FICTIONAL '+season+' electricity bill - software test only')
 c.setFont('Helvetica-Bold',19);c.drawString(45,790,'FICTIONAL BILL - TEST ONLY')
 c.setFont('Helvetica',12)
 lines=[f'Season: {season}',f'Consumption period: {period}',f'Billing days: {days}',f'Electricity consumed: {kwh} kWh',f'Meter register start: 50000 kWh',f'Meter register end: {50000+kwh} kWh',f'Electricity charges including GST: NZD {total:.2f}','Broadband including GST: NZD 90.00',f'Total invoice including GST: NZD {total+90:.2f}','Tariff rates not printed: flag unit and daily rates for review.','No customer, account, address or payment details.']
 for i,line in enumerate(lines):c.drawString(45,745-i*30,line)
 c.save()
