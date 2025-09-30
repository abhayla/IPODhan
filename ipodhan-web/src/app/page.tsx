import Hero from '@/components/Hero'
import LiveIPOList from '@/components/LiveIPOList'
import Features from '@/components/Features'
import Navigation from '@/components/Navigation'

export default function Home() {
  return (
    <>
      <Navigation />
      <main>
        <Hero />
        <LiveIPOList />
        <Features />
      </main>
    </>
  )
}