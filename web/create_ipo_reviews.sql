-- Create review_recommendation enum if it doesn't exist
DO $$ BEGIN
  CREATE TYPE review_recommendation AS ENUM('May apply', 'Subscribe', 'Avoid', 'Not Recommended');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create ipo_reviews table if it doesn't exist
CREATE TABLE IF NOT EXISTS ipo_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_title varchar(500) NOT NULL,
  author varchar(255) NOT NULL,
  recommendation review_recommendation NOT NULL,
  ipo_id uuid NOT NULL,
  published_date timestamp NOT NULL,
  year integer NOT NULL,
  category ipo_category NOT NULL,
  review_url text,
  review_content text,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL,
  FOREIGN KEY (ipo_id) REFERENCES ipos(id) ON DELETE cascade ON UPDATE cascade
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_ipo_reviews_ipo_id ON ipo_reviews(ipo_id);
CREATE INDEX IF NOT EXISTS idx_ipo_reviews_year ON ipo_reviews(year);
CREATE INDEX IF NOT EXISTS idx_ipo_reviews_category ON ipo_reviews(category);
CREATE INDEX IF NOT EXISTS idx_ipo_reviews_category_year_published ON ipo_reviews(category, year, published_date);
