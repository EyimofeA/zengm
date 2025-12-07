import csv
import pandas as pd
import numpy as np
from sklearn.linear_model import RidgeCV
from scipy.sparse import csr_matrix
import argparse

# Step 1: Prepare Data
def prepare_data(csv_file, seasons=None):
    possessions = pd.read_csv(csv_file)
    # Filter by seasons if provided
    if seasons is not None:
        possessions = possessions[possessions['season'].isin(seasons)]

    if possessions.empty:
        raise ValueError("No data available for the specified seasons.")

    player_list, player_index = build_player_list(possessions)
    return possessions, player_list, player_index

def build_player_list(possessions):
    offense_players = possessions[['homePlayer1Id', 'homePlayer2Id', 'homePlayer3Id',
                                   'homePlayer4Id', 'homePlayer5Id']].values.flatten()
    defense_players = possessions[['awayPlayer1Id', 'awayPlayer2Id', 'awayPlayer3Id',
                                   'awayPlayer4Id', 'awayPlayer5Id']].values.flatten()
    players = set(offense_players).union(set(defense_players))
    players = [int(p) for p in players if not np.isnan(p)]
    players.sort()
    # Create a mapping from player ID to index
    player_index = {player_id: idx for idx, player_id in enumerate(players)}
    return players, player_index
def run_rapm(possessions,player_list, player_index):
    train_x, train_y, sample_weights = construct_design_matrix(possessions, player_index)
    # Use specified alphas
    alphas = [1500, 1750, 2000, 2250, 2500, 2750, 3000, 3250, 3500, 3750, 4000,5000,6000]
    results, intercept = calculate_rapm(train_x, train_y, alphas, player_list,sample_weights=sample_weights)
    return results
# Step 2: Convert to Sparse Matrices
def construct_design_matrix(data, player_index):
    num_players = len(player_index)
    data_records = []
    y_values = []
    sample_weights = []
    row_ind = []
    col_ind = []
    data_values = []

    for idx, row in data.iterrows():
        # Homehome observation
        if row['homePossessions'] > 0:
            # Assign +1 to home offensive players
            for player_col in ['homePlayer1Id', 'homePlayer2Id', 'homePlayer3Id', 'homePlayer4Id', 'homePlayer5Id']:
                player_id = row[player_col]
                col_idx = player_index[player_id]
                row_ind.append(len(y_values))
                col_ind.append(col_idx)
                data_values.append(1)

            # Assign +1 to away defensive players
            for player_col in ['awayPlayer1Id', 'awayPlayer2Id', 'awayPlayer3Id', 'awayPlayer4Id', 'awayPlayer5Id']:
                player_id = row[player_col]
                col_idx = player_index[player_id] + num_players
                row_ind.append(len(y_values))
                col_ind.append(col_idx)
                data_values.append(1)

            # Target variable and sample weight
            y_values.append(row['homePoints'] / row['homePossessions'])
            sample_weights.append(row['homePossessions'])

        # Away team offense observation
        if row['awayPossessions'] > 0:
            # Assign +1 to away offensive players
            for player_col in ['awayPlayer1Id', 'awayPlayer2Id', 'awayPlayer3Id', 'awayPlayer4Id', 'awayPlayer5Id']:
                player_id = row[player_col]
                col_idx = player_index[player_id]
                row_ind.append(len(y_values))
                col_ind.append(col_idx)
                data_values.append(1)

            # Assign +1 to home defensive players
            for player_col in ['homePlayer1Id', 'homePlayer2Id', 'homePlayer3Id', 'homePlayer4Id', 'homePlayer5Id']:
                player_id = row[player_col]
                col_idx = player_index[player_id] + num_players
                row_ind.append(len(y_values))
                col_ind.append(col_idx)
                data_values.append(1)

            # Target variable and sample weight
            y_values.append(row['awayPoints'] / row['awayPossessions'])
            sample_weights.append(row['awayPossessions'])

    num_samples = len(y_values)
    X = csr_matrix((data_values, (row_ind, col_ind)), shape=(num_samples, num_players * 2))
    y = np.array(y_values)
    sample_weights = np.array(sample_weights)
    return X, y, sample_weights

# Step 3: Run RAPM Calculation
def calculate_rapm(train_x, train_y, alphas, player_list,sample_weights):
    num_samples = train_x.shape[0]
    cv = min(5, num_samples)

    clf = RidgeCV(alphas=alphas, fit_intercept=True, cv=cv, scoring='neg_mean_squared_error')
    clf.fit(train_x, train_y,sample_weight=sample_weights)
    coef = clf.coef_
    intercept = clf.intercept_

    num_players = len(player_list)
    offensive_coef = coef[:num_players]
    defensive_coef = coef[num_players:]

    results = pd.DataFrame({
        'playerId': player_list,
        'RAPM_Off': offensive_coef*100,
        'RAPM_Def': defensive_coef*100
    })
    print('ALPHA:', clf.alpha_)
    results['RAPM'] = results['RAPM_Off'] - results['RAPM_Def']
    results['RAPM_Rank'] = results['RAPM'].rank(ascending=False)
    return results, intercept

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Calculate RAPM.')
    parser.add_argument('--start-season', type=int, help='Start season (inclusive).')
    parser.add_argument('--end-season', type=int, help='End season (inclusive).')
    parser.add_argument('--interval', type=int, default=0, help='Interval of years for RAPM calculation (e.g., 3 for every 3 years). Default is 0, which runs over the specified seasons.')
    args = parser.parse_args()
    seasons = None
    if args.start_season and args.end_season:
        seasons = list(range(args.start_season, args.end_season + 1))

    # Step 1: Prepare Data
    possessions, player_list, player_index = prepare_data('bbgm_rapm/transformed_lineup_data.csv', seasons=seasons)

    # Check if possessions are empty after filtering
    if possessions.empty:
        print("No data available for the specified seasons.")
        exit()
    # Run RAPM calculation
    if args.interval > 0 and (seasons is not None):
        print("in here")
        all_seasons = seasons
        all_results = pd.DataFrame()
        n_years = args.interval
        for i in range(0, len(all_seasons)):
            if i + n_years > len(all_seasons):
                break  # Skip incomplete intervals
            interval_seasons = all_seasons[i:i + n_years]
            print(f"Calculating RAPM for seasons {interval_seasons[0]} to {interval_seasons[-1]}")
            possessions_interval = possessions[possessions['season'].isin(interval_seasons)]
            if possessions_interval.empty:
                print("No data available for the specified seasons.")
                continue
            possessions_interval, player_list_interval, player_index_interval = prepare_data('transformed_lineup_data.csv', seasons=interval_seasons)
            results = run_rapm(possessions_interval, player_list_interval, player_index_interval)
            season_range = f"{interval_seasons[0]}-{str(interval_seasons[-1])[-2:]}"  # Format as "2000-03"
            results['season_range'] = season_range
            player_names = pd.read_csv('players.csv')
            results = results.merge(player_names, on='playerId', how='left')
            results = results[['playerId', 'First Name', 'Last Name', 'RAPM', 'RAPM_Rank', 'RAPM_Off', 'RAPM_Def','season_range']]
            all_results = pd.concat([all_results, results], ignore_index=True)
            print(results.sort_values('RAPM', ascending=False).head(5))
        # Save all results to a single CSV
        output_file = f'bbgm_rapm/rapm_results_{seasons[0]}_{seasons[-1]}_interval_{args.interval}.csv'
        all_results.to_csv(output_file, index=False)
            
    else:
        results = run_rapm(possessions, player_list, player_index)

        # Merge with player names
        player_names = pd.read_csv('bbgm_rapm/players.csv')
        results = results.merge(player_names, on='playerId', how='left')
        results = results[['playerId', 'First Name', 'Last Name', 'RAPM', 'RAPM_Rank', 'RAPM_Off', 'RAPM_Def']]

        # Save results
        if seasons:
            output_file = f'bbgm_rapm/rapm_results_{seasons[0]}_{seasons[-1]}.csv'
        else:
            output_file = 'bbgm_rapm/rapm_results.csv'
        results.to_csv(output_file, index=False)

        # Display top players
        print(results.sort_values('RAPM', ascending=False).head(20))

    