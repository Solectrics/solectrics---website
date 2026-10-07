import { assertAccountingDateOpen, safeAccountingDate } from "./bookkeeping-controls.js";
import { validateJournalLines } from "./bookkeeping-core.js";

const money = value => Math.round((Number(value) || 0) * 100) / 100;
const fail = (error, status=400, extra={}) => Response.json({ok:false,error,...extra},{status});
const clean = (value,max=500) => String(value ?? "").trim().slice(0,max);

async function loadBook(db,id){
  return db.prepare("SELECT * FROM bookkeeping_books WHERE id=? AND active=1").bind(id).first();
}
async function accountsByCode(db,bookId,codes){
  const placeholders=codes.map(()=>"?").join(",");
  const rows=await db.prepare(`SELECT id,code FROM bookkeeping_accounts
    WHERE book_id=? AND is_active=1 AND code IN (${placeholders})`).bind(bookId,...codes).all();
  return new Map((rows.results||[]).map(r=>[r.code,r.id]));
}

export async function onRequestGet(context){
  const db=context.env.DB;
  if(!db) return fail("D1 database binding DB is not available",500);
  try{
    const url=new URL(context.request.url);
    const bookId=clean(url.searchParams.get("book_id"),100);
    const view=clean(url.searchParams.get("view")||"gst",40);
    if(!bookId || !(await loadBook(db,bookId))) return fail("A valid book_id is required");

    if(view==="gst"){
      const from=safeAccountingDate(url.searchParams.get("from"));
      const to=safeAccountingDate(url.searchParams.get("to"));
      if(!from||!to) return fail("from and to must use YYYY-MM-DD");
      const book=await loadBook(db,bookId);
      const events=await db.prepare(`SELECT event_date,event_type,amount,description,reference_number,transaction_id
        FROM bookkeeping_tax_events
        WHERE book_id=? AND tax_type='gst' AND event_date>=? AND event_date<=?
        ORDER BY event_date,created_at`).bind(bookId,from,to).all();
      const rows=events.results||[];
      const net=money(rows.reduce((sum,row)=>sum+Number(row.amount||0),0));
      const output=money(rows.filter(r=>Number(r.amount)>0).reduce((s,r)=>s+Number(r.amount||0),0));
      const input=money(-rows.filter(r=>Number(r.amount)<0).reduce((s,r)=>s+Number(r.amount||0),0));
      return Response.json({ok:true,report:"gst",book:{id:book.id,name:book.name,gst_basis:book.gst_basis,gst_registered:book.gst_registered},
        period:{from,to},output_gst:output,allowable_input_gst:input,net_gst_payable:net,events:rows});
    }

    if(view==="locks"){
      const rows=await db.prepare(`SELECT id,lock_type,locked_through,reason,locked_by,active,created_at,released_at,released_by,release_reason
        FROM bookkeeping_period_locks WHERE book_id=? ORDER BY created_at DESC`).bind(bookId).all();
      return Response.json({ok:true,locks:rows.results||[]});
    }

    if(view==="adjustments"){
      const rows=await db.prepare(`SELECT a.*,t.transaction_date,t.reference_number,t.description
        FROM bookkeeping_accountant_adjustments a
        JOIN bookkeeping_transactions t ON t.id=a.transaction_id
        WHERE a.book_id=? ORDER BY a.created_at DESC`).bind(bookId).all();
      return Response.json({ok:true,adjustments:rows.results||[]});
    }

    if(view==="credit_notes"){
      const rows=await db.prepare(`SELECT * FROM bookkeeping_credit_notes WHERE book_id=? ORDER BY credit_date DESC,created_at DESC`)
        .bind(bookId).all();
      return Response.json({ok:true,credit_notes:rows.results||[]});
    }

    return fail("Unsupported accountant view");
  }catch(error){
    console.error("Accountant controls GET error:",error);
    return fail("Unable to load accountant controls",500);
  }
}

export async function onRequestPost(context){
  const db=context.env.DB;
  if(!db) return fail("D1 database binding DB is not available",500);
  try{
    const body=await context.request.json();
    const action=clean(body.action,40);
    const bookId=clean(body.book_id,100);
    const book=await loadBook(db,bookId);
    if(!book) return fail("A valid book_id is required");

    if(action==="lock_period"){
      const through=safeAccountingDate(body.locked_through);
      const type=new Set(["month","gst","year","accountant"]).has(body.lock_type)?body.lock_type:"accountant";
      const reason=clean(body.reason,1000), actor=clean(body.actor||"Accountant",160);
      if(!through||!reason) return fail("locked_through and reason are required");
      await db.batch([
        db.prepare(`INSERT INTO bookkeeping_period_locks
          (id,book_id,lock_type,locked_through,reason,locked_by)
          VALUES (?,?,?,?,?,?)`).bind(crypto.randomUUID(),bookId,type,through,reason,actor),
        db.prepare(`INSERT INTO bookkeeping_audit_events
          (id,book_id,entity_type,entity_id,action,actor,after_json)
          VALUES (?,?,'period_lock',?,'locked',?,?)`)
          .bind(crypto.randomUUID(),bookId,`${type}:${through}`,actor,JSON.stringify({locked_through:through,lock_type:type,reason}))
      ]);
      return Response.json({ok:true});
    }

    if(action==="release_lock"){
      const lockId=clean(body.lock_id,100), actor=clean(body.actor||"Accountant",160), reason=clean(body.reason,1000);
      const lock=await db.prepare("SELECT * FROM bookkeeping_period_locks WHERE id=? AND book_id=? AND active=1").bind(lockId,bookId).first();
      if(!lock) return fail("Active lock not found",404);
      if(!reason) return fail("Release reason is required");
      await db.batch([
        db.prepare(`UPDATE bookkeeping_period_locks SET active=0,released_at=CURRENT_TIMESTAMP,released_by=?,release_reason=? WHERE id=?`)
          .bind(actor,reason,lockId),
        db.prepare(`INSERT INTO bookkeeping_audit_events
          (id,book_id,entity_type,entity_id,action,actor,after_json)
          VALUES (?,?,'period_lock',?,'released',?,?)`)
          .bind(crypto.randomUUID(),bookId,lockId,actor,JSON.stringify({reason}))
      ]);
      return Response.json({ok:true});
    }

    if(action==="customer_credit_note"){
      const originalId=clean(body.original_transaction_id,100);
      const creditDate=safeAccountingDate(body.credit_date);
      const reason=clean(body.reason,1000), actor=clean(body.actor||"Job Hub user",160);
      const original=await db.prepare(`SELECT * FROM bookkeeping_transactions
        WHERE id=? AND book_id=? AND kind='sales_invoice'`).bind(originalId,bookId).first();
      if(!original) return fail("Original sales invoice not found",404);
      if(!creditDate||!reason) return fail("credit_date and reason are required");
      await assertAccountingDateOpen(db,bookId,creditDate);
      const ex=money(body.ex_gst_amount ?? original.ex_gst_amount);
      const gst=money(body.gst_amount ?? original.gst_amount);
      const total=money(body.total_incl_gst ?? original.total_incl_gst);
      if(ex<0||gst<0||total<=0||money(ex+gst)!==total) return fail("Credit amounts must be positive and add up");
      if(ex>Number(original.ex_gst_amount)+0.01 || gst>Number(original.gst_amount)+0.01 || total>Number(original.total_incl_gst)+0.01)
        return fail("Credit note cannot exceed the original sales invoice");
      const creditNumber=clean(body.credit_number,100)||`CR-${clean(original.reference_number||original.id,60)}`;
      const acc=await accountsByCode(db,bookId,["1100","2200","4000"]);
      if(!acc.get("1100")||!acc.get("4000")||(gst&&!acc.get("2200"))) return fail("Required accounting controls are missing",409);
      const txId=crypto.randomUUID(), journalId=crypto.randomUUID(), noteId=crypto.randomUUID();
      const lines=[
        {account_id:acc.get("4000"),debit:ex,credit:0},
        ...(gst?[{account_id:acc.get("2200"),debit:gst,credit:0}]:[]),
        {account_id:acc.get("1100"),debit:0,credit:total}
      ];
      const balance=validateJournalLines(lines);
      if(!balance.ok) return fail(balance.error);
      const stmts=[
        db.prepare(`INSERT INTO bookkeeping_transactions
          (id,book_id,job_id,kind,transaction_date,reference_number,contact_name,description,status,reconciliation_status,
           gst_treatment,ex_gst_amount,gst_amount,total_incl_gst,historical,source_type,source_id,metadata_json)
          VALUES (?,?,?,'adjustment',?,?,?,?, 'unpaid','unreconciled',?,?,?,?,0,'customer_credit_note',?,?)`)
          .bind(txId,bookId,original.job_id||null,creditDate,creditNumber,original.contact_name||null,
            `Customer credit note against ${original.reference_number||original.id}`,gst?"standard":"no_gst",-ex,-gst,-total,
            originalId,JSON.stringify({original_transaction_id:originalId,reason})),
        db.prepare(`INSERT INTO bookkeeping_journals
          (id,book_id,transaction_id,journal_date,reference_number,description,source,posted)
          VALUES (?,?,?,?,?,?,'customer_credit_note',1)`)
          .bind(journalId,bookId,txId,creditDate,creditNumber,`Customer credit note against ${original.reference_number||original.id}`),
        db.prepare(`INSERT INTO bookkeeping_credit_notes
          (id,book_id,job_id,original_transaction_id,source_invoice_id,credit_number,credit_date,reason,
           ex_gst_amount,gst_amount,total_incl_gst,transaction_id,issued_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(noteId,bookId,original.job_id||null,originalId,original.source_id||null,creditNumber,creditDate,reason,ex,gst,total,txId,actor),
        db.prepare(`INSERT INTO bookkeeping_audit_events
          (id,book_id,transaction_id,entity_type,entity_id,action,actor,after_json)
          VALUES (?,?,?,'credit_note',?,'issued',?,?)`)
          .bind(crypto.randomUUID(),bookId,txId,noteId,actor,JSON.stringify({original_transaction_id:originalId,credit_number:creditNumber,ex,gst,total,reason}))
      ];
      for(const line of lines){
        stmts.push(db.prepare(`INSERT INTO bookkeeping_journal_lines
          (id,journal_id,account_id,description,debit,credit,ex_gst_amount,gst_amount,total_incl_gst,gst_treatment,contact_name,job_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(crypto.randomUUID(),journalId,line.account_id,`Credit note ${creditNumber}`,line.debit,line.credit,0,0,0,"no_gst",original.contact_name||null,original.job_id||null));
      }
      if(gst && (book.gst_basis==="invoice"||book.gst_basis==="hybrid")){
        stmts.push(db.prepare(`INSERT INTO bookkeeping_tax_events
          (id,book_id,tax_type,event_type,transaction_id,event_date,reference_number,description,amount,metadata_json)
          VALUES (?,?,'gst','adjustment',?,?,?,'Output GST reversed by customer credit note',?,?)`)
          .bind(crypto.randomUUID(),bookId,txId,creditDate,creditNumber,-gst,JSON.stringify({original_transaction_id:originalId,credit_note_id:noteId})));
      }
      await db.batch(stmts);
      return Response.json({ok:true,credit_note_id:noteId,transaction_id:txId,credit_number:creditNumber},{status:201});
    }

    if(action==="accountant_adjustment"){
      const transaction=body.transaction||{}, journal=body.journal||{}, lines=Array.isArray(body.lines)?body.lines:[];
      const date=safeAccountingDate(transaction.transaction_date);
      if(!date) return fail("A valid transaction_date is required");
      await assertAccountingDateOpen(db,bookId,date);
      const reason=clean(body.reason,1000), preparedBy=clean(body.prepared_by||body.actor||"",160);
      if(!reason||!preparedBy) return fail("reason and prepared_by are required");
      const balance=validateJournalLines(lines);
      if(!balance.ok) return fail(balance.error);
      const ids=[...new Set(lines.map(l=>clean(l.account_id,100)))];
      if(!ids.length) return fail("At least one journal line is required");
      const placeholders=ids.map(()=>"?").join(",");
      const owned=await db.prepare(`SELECT id FROM bookkeeping_accounts WHERE book_id=? AND is_active=1 AND id IN (${placeholders})`)
        .bind(bookId,...ids).all();
      if((owned.results||[]).length!==ids.length) return fail("All journal lines must use accounts from this book");
      const txId=crypto.randomUUID(), journalId=crypto.randomUUID(), adjustmentId=crypto.randomUUID();
      const stmts=[
        db.prepare(`INSERT INTO bookkeeping_transactions
          (id,book_id,kind,transaction_date,reference_number,description,status,reconciliation_status,gst_treatment,
           ex_gst_amount,gst_amount,total_incl_gst,historical,source_type,source_id,metadata_json)
          VALUES (?,?,'adjustment',?,?,?,'posted','reconciled','no_gst',0,0,0,0,'accountant_adjustment',?,?)`)
          .bind(txId,bookId,date,clean(transaction.reference_number,100)||null,clean(transaction.description,1000)||reason,adjustmentId,
            JSON.stringify({reason,prepared_by:preparedBy,adjustment_type:clean(body.adjustment_type,80)||"year_end"})),
        db.prepare(`INSERT INTO bookkeeping_journals
          (id,book_id,transaction_id,journal_date,reference_number,description,source,posted)
          VALUES (?,?,?,?,?,?,'accountant_adjustment',1)`)
          .bind(journalId,bookId,txId,date,clean(journal.reference_number||transaction.reference_number,100)||null,
            clean(journal.description||transaction.description,1000)||reason),
        db.prepare(`INSERT INTO bookkeeping_accountant_adjustments
          (id,book_id,transaction_id,adjustment_type,reason,prepared_by)
          VALUES (?,?,?,?,?,?)`)
          .bind(adjustmentId,bookId,txId,clean(body.adjustment_type,80)||"year_end",reason,preparedBy),
        db.prepare(`INSERT INTO bookkeeping_audit_events
          (id,book_id,transaction_id,entity_type,entity_id,action,actor,after_json)
          VALUES (?,?,?,'accountant_adjustment',?,'posted',?,?)`)
          .bind(crypto.randomUUID(),bookId,txId,adjustmentId,preparedBy,JSON.stringify({reason,lines}))
      ];
      for(const line of lines){
        stmts.push(db.prepare(`INSERT INTO bookkeeping_journal_lines
          (id,journal_id,account_id,description,debit,credit,ex_gst_amount,gst_amount,total_incl_gst,gst_treatment,contact_name,job_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(crypto.randomUUID(),journalId,clean(line.account_id,100),clean(line.description,1000)||reason,
            Number(line.debit||0),Number(line.credit||0),Number(line.ex_gst_amount||0),Number(line.gst_amount||0),
            Number(line.total_incl_gst||0),clean(line.gst_treatment,40)||"no_gst",clean(line.contact_name,200)||null,
            Number.isInteger(Number(line.job_id))?Number(line.job_id):null));
      }
      await db.batch(stmts);
      return Response.json({ok:true,adjustment_id:adjustmentId,transaction_id:txId,journal_id:journalId},{status:201});
    }

    return fail("Unsupported accountant action");
  }catch(error){
    if(error?.code==="ACCOUNTING_PERIOD_LOCKED") return fail(error.message,409,{lock:error.lock});
    console.error("Accountant controls POST error:",error);
    return fail("Unable to process accountant action",500);
  }
}
