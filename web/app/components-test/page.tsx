import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { notFound } from "next/navigation";

export default function ComponentsTestPage() {
  // Internal component gallery — never exposed in production (GitHub #11).
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div>
          <h1 className="text-4xl font-bold text-foreground mb-2">shadcn/ui Components Test</h1>
          <p className="text-muted-foreground">Testing all base components with PRD theme</p>
        </div>

        {/* Buttons Section */}
        <Card>
          <CardHeader>
            <CardTitle>Button Component</CardTitle>
            <CardDescription>Various button styles and variants</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <Button>Primary Button</Button>
            <Button variant="secondary">Secondary Button</Button>
            <Button variant="destructive">Destructive Button</Button>
            <Button variant="outline">Outline Button</Button>
            <Button variant="ghost">Ghost Button</Button>
            <Button variant="link">Link Button</Button>
          </CardContent>
        </Card>

        {/* Cards Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>IPO Card Example</CardTitle>
              <CardDescription>Sample IPO listing card</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <p className="text-sm">Price Range: ₹100 - ₹120</p>
                <p className="text-sm">Opens: 15 Jan 2024</p>
              </div>
            </CardContent>
            <CardFooter>
              <Button className="w-full">View Details</Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status Badges</CardTitle>
              <CardDescription>Color-coded status indicators</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge className="bg-chart-1 text-white">Open</Badge>
              <Badge className="bg-chart-2 text-white">Upcoming</Badge>
              <Badge className="bg-muted-foreground text-white">Closed</Badge>
              <Badge variant="destructive">Error</Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Form Elements</CardTitle>
              <CardDescription>Input and select components</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input placeholder="Search IPOs..." />
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="upcoming">Upcoming</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        </div>

        {/* Dialog Section */}
        <Card>
          <CardHeader>
            <CardTitle>Dialog Component</CardTitle>
            <CardDescription>Modal dialog example</CardDescription>
          </CardHeader>
          <CardContent>
            <Dialog>
              <DialogTrigger asChild>
                <Button>Open Dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>IPO Details</DialogTitle>
                  <DialogDescription>
                    This is a sample dialog showing IPO information. The dialog is responsive and works on all devices.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <p>Company Name: Sample IPO Ltd.</p>
                  <p>Price Range: ₹100 - ₹120</p>
                  <p>Subscription: 5.2x</p>
                  <Button className="w-full">Subscribe</Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>

        {/* Color Palette Display */}
        <Card>
          <CardHeader>
            <CardTitle>PRD Color Palette</CardTitle>
            <CardDescription>Theme colors from requirements</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="space-y-2">
                <div className="h-16 bg-primary rounded border" />
                <p className="text-xs">Primary Blue</p>
                <p className="text-xs text-muted-foreground">#2563eb</p>
              </div>
              <div className="space-y-2">
                <div className="h-16 bg-chart-1 rounded border" />
                <p className="text-xs">Success Green</p>
                <p className="text-xs text-muted-foreground">#10b981</p>
              </div>
              <div className="space-y-2">
                <div className="h-16 bg-chart-4 rounded border" />
                <p className="text-xs">Warning Yellow</p>
                <p className="text-xs text-muted-foreground">#f59e0b</p>
              </div>
              <div className="space-y-2">
                <div className="h-16 bg-destructive rounded border" />
                <p className="text-xs">Danger Red</p>
                <p className="text-xs text-muted-foreground">#ef4444</p>
              </div>
              <div className="space-y-2">
                <div className="h-16 bg-muted-foreground rounded border" />
                <p className="text-xs">Medium Gray</p>
                <p className="text-xs text-muted-foreground">#6b7280</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Responsive Test */}
        <Card>
          <CardHeader>
            <CardTitle>Responsive Design Test</CardTitle>
            <CardDescription>This page is responsive - try resizing your browser</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              All components adapt to mobile, tablet, and desktop viewports. The grid layout adjusts from 1 column on mobile to 3 columns on desktop.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
