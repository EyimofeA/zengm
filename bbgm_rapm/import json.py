import csv

# Input and output CSV file paths
input_csv = "bbgm_rapm/lineupData-data.csv"
output_csv = "bbgm_rapm/transformed_lineup_data.csv"

# New headers
new_headers = [
    "homePlayer1Id", "homePlayer2Id", "homePlayer3Id", "homePlayer4Id", "homePlayer5Id",
    "awayPlayer1Id", "awayPlayer2Id", "awayPlayer3Id", "awayPlayer4Id", "awayPlayer5Id",
    "homePossessions", "homePoints", "awayPossessions", "awayPoints", "season", "id"
]

# Function to expand rows to match the new headers
def expand_row(row):
    return row + [""] * (len(new_headers) - len(row))

# Read, process, and write the CSV
with open(input_csv, "r") as infile, open(output_csv, "w", newline="") as outfile:
    reader = csv.reader(infile)
    writer = csv.writer(outfile)

    # Write the new headers
    writer.writerow(new_headers)

    # Skip the original header row
    next(reader, None)

    # Process each row to match the new headers
    for row in reader:
        expanded_row = expand_row(row)
        writer.writerow(expanded_row)

print(f"Adjusted CSV written to {output_csv}")