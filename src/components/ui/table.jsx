import * as React from "react"

import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { ChevronRight } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"

const elements = children => React.Children.toArray(children).flatMap(child => React.isValidElement(child) && child.type === React.Fragment ? elements(child.props.children) : [child]).filter(React.isValidElement)
const nameOf = element => typeof element.type === 'string' ? element.type : element.type.displayName
const contentText = node => typeof node === 'string' || typeof node === 'number' ? String(node) : React.isValidElement(node) ? contentText(node.props.children) : Array.isArray(node) ? node.map(contentText).join(' ') : ''

/** A mobile summary opens the complete original row, including its permitted actions. */
const Table = React.forwardRef(({ className, children, mobileColumns = undefined, mobileSecondary = undefined, mobileSearch = false, ...props }, ref) => {
  const mobile = useIsMobile()
  const [detailKey, setDetailKey] = React.useState(null)
  const [query, setQuery] = React.useState('')
  const sections = elements(children)
  const head = sections.find(node => ['TableHeader', 'thead'].includes(nameOf(node)))
  const body = sections.find(node => ['TableBody', 'tbody'].includes(nameOf(node)))
  const headers = elements(elements(head?.props.children)[0]?.props.children)
  const rows = elements(body?.props.children).filter(row => !mobile || !mobileSearch || !query.trim() || contentText(row.props.children).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const detail = rows.find((row, index) => String(row.key ?? index) === detailKey)
  const labels = headers.map(cell => contentText(cell.props.children))
  const preferred = labels.findIndex((label, index) => index > 0 && /neto|disponible|cantidad|kilos|promedio|variedad|pallets/i.test(label))
  const state = labels.findIndex((label, index) => index > 0 && /estado|mayor espera|situación/i.test(label))
  const indices = (mobileColumns || [...new Set([0, preferred > 0 ? preferred : 1, state > 0 ? state : 2])]).filter(index => index < headers.length)
  const canSummarize = mobile && headers.length > 3 && body
  if (!canSummarize) return <div className="relative w-full overflow-auto"><table ref={ref} className={cn("w-full caption-bottom text-sm [overflow-wrap:normal]", mobile ? "mobile-record-table" : "min-w-[40rem] [&_td]:whitespace-nowrap", className)} {...props}>{children}</table></div>
  const cellsOf = row => elements(row.props.children)
  const openRow = (row, index, event) => {
    if (event.target.closest('button,a,input,select,textarea,[role="button"]')) return
    if (row.props.onClick) row.props.onClick(event)
    else setDetailKey(String(row.key ?? index))
  }
  return <>
    {mobileSearch && <Input type="search" className="mb-3" placeholder="Buscar código, productor o variedad" aria-label="Buscar registros" value={query} onChange={event => setQuery(event.target.value)}/>}
    <table ref={ref} className="mobile-record-table w-full table-fixed text-sm" {...props}>
      <thead><tr className="border-b">{indices.map(index => <th key={index} scope="col" className="px-2 py-3 text-left text-xs font-medium text-muted-foreground">{headers[index].props.children}</th>)}<th className="w-9"><span className="sr-only">Detalle</span></th></tr></thead>
      <tbody>{!rows.length && <tr><td className="p-4 text-muted-foreground" colSpan={indices.length+1}>Sin registros para mostrar.</td></tr>}{rows.map((row, rowIndex) => {
        const cells = cellsOf(row)
        if (cells.length === 1 && cells[0].props.colSpan) return <tr key={row.key ?? rowIndex}><td colSpan={indices.length + 1} className="p-4">{cells[0].props.children}</td></tr>
        return <tr key={row.key ?? rowIndex} className="border-b last:border-0 cursor-pointer" onClick={event => openRow(row, rowIndex, event)}>
          {indices.map(index => <td key={index} className="px-2 py-4 align-top">{cells[index]?.props.children}{mobileSecondary?.[index] != null && <div className="mt-1 text-xs text-muted-foreground">{cells[mobileSecondary[index]]?.props.children}</div>}</td>)}
          <td className="px-0 py-2 align-middle"><button type="button" className="min-h-11 w-9 inline-flex items-center justify-center rounded focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Ver todos los datos: ${contentText(cells[0]?.props.children) || 'registro'}`} onClick={event => { event.stopPropagation(); if (row.props.onClick) row.props.onClick(event); else setDetailKey(String(row.key ?? rowIndex)) }}><ChevronRight className="h-4 w-4"/></button></td>
        </tr>
      })}</tbody>
    </table>
    <Dialog open={Boolean(detail)} onOpenChange={open => !open && setDetailKey(null)}><DialogContent><DialogHeader><DialogTitle>Detalle del registro</DialogTitle><DialogDescription>Todos los datos y acciones disponibles para tu perfil.</DialogDescription></DialogHeader><dl className="space-y-4">{detail && cellsOf(detail).map((cell, index) => <div key={index} className="border-b pb-3 last:border-0"><dt className="text-xs text-muted-foreground mb-1">{headers[index]?.props.children || 'Información'}</dt><dd className="text-sm break-words">{cell.props.children}</dd></div>)}</dl></DialogContent></Dialog>
  </>
})
Table.displayName = "Table"

const TableHeader = React.forwardRef(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props} />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
    {...props} />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className
    )}
    {...props} />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props} />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className
    )}
    {...props} />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props} />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
