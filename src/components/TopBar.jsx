export default function TopBar({ title, description }) {
  return (
    <header className="px-4 md:px-8 pt-8 pb-6">
      <h1 className="font-display font-bold text-2xl text-navy-950">{title}</h1>
      {description && (
        <p className="text-sm text-navy-950/60 mt-1 max-w-2xl">{description}</p>
      )}
    </header>
  )
}
